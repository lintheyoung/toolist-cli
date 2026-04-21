import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { apiRequest } from '../../lib/http.js';
import { assertJobSucceeded } from '../../lib/job-errors.js';
import {
  NETWORK_RETRY_ATTEMPTS,
  NETWORK_RETRY_DELAYS_MS,
  withRetry,
} from '../../lib/retry.js';
import {
  silentProgressReporter,
  type ProgressReporter,
} from '../../lib/progress-reporter.js';
import { uploadCommand } from '../files/upload.js';
import { waitJobCommand } from '../jobs/wait.js';

export interface ImageRemoveWatermarkCommandArgs {
  input: string;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl: string;
  token: string;
  configPath?: string;
}

export interface ImageRemoveWatermarkJobOutput {
  outputFileId?: string;
  mimeType?: string;
  storageKey?: string;
  [key: string]: unknown;
}

export interface ImageRemoveWatermarkJobResult {
  id: string;
  status: string;
  toolName: string;
  toolVersion: string;
  input?: Record<string, unknown>;
  result?: {
    output?: ImageRemoveWatermarkJobOutput;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

function isTerminalJobStatus(status: string): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'canceled' ||
    status === 'timed_out'
  );
}

function getOutputFileId(job: ImageRemoveWatermarkJobResult): string | null {
  if (!job.result || typeof job.result !== 'object') {
    return null;
  }

  const output = (job.result as { output?: unknown }).output;

  if (!output || typeof output !== 'object') {
    return null;
  }

  return typeof (output as { outputFileId?: unknown }).outputFileId === 'string'
    ? (output as { outputFileId: string }).outputFileId
    : null;
}

export interface ImageRemoveWatermarkDependencies {
  apiRequest: typeof apiRequest;
  uploadCommand: typeof uploadCommand;
  waitJobCommand: typeof waitJobCommand;
  fetch: typeof fetch;
  writeFile: typeof writeFile;
  randomUUID: typeof randomUUID;
  progress: ProgressReporter;
}

type CreateJobResponse = {
  data: {
    job: ImageRemoveWatermarkJobResult;
  };
  request_id: string;
};

function createDefaultDependencies(): ImageRemoveWatermarkDependencies {
  return {
    apiRequest,
    uploadCommand,
    waitJobCommand,
    fetch: globalThis.fetch.bind(globalThis),
    writeFile,
    randomUUID,
    progress: silentProgressReporter,
  };
}

function buildDownloadUrl(baseUrl: string, fileId: string): string {
  return new URL(`/api/v1/files/${encodeURIComponent(fileId)}/download`, baseUrl).toString();
}

async function downloadOutputFile(
  args: Pick<ImageRemoveWatermarkCommandArgs, 'baseUrl' | 'token' | 'output'>,
  outputFileId: string,
  dependencies: Pick<ImageRemoveWatermarkDependencies, 'fetch' | 'writeFile'>,
): Promise<void> {
  if (!args.output) {
    return;
  }

  const response = await withRetry({
    stage: 'Output download failed',
    attempts: NETWORK_RETRY_ATTEMPTS,
    delaysMs: NETWORK_RETRY_DELAYS_MS,
    fn: () =>
      dependencies.fetch(buildDownloadUrl(args.baseUrl, outputFileId), {
        headers: {
          authorization: `Bearer ${args.token}`,
        },
      }),
  });

  if (!response.ok) {
    throw new Error(`Failed to download watermark-removed file ${outputFileId}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await dependencies.writeFile(args.output, bytes);
}

export async function imageRemoveWatermarkCommand(
  args: ImageRemoveWatermarkCommandArgs,
  dependencies: Partial<ImageRemoveWatermarkDependencies> = {},
): Promise<ImageRemoveWatermarkJobResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  deps.progress.uploadingInput();
  const sourceFile = await deps.uploadCommand({
    input: args.input,
    baseUrl: args.baseUrl,
    token: args.token,
    configPath: args.configPath,
  });
  deps.progress.uploadedFile(sourceFile.file_id);

  deps.progress.creatingJob();
  const createJobResponse = await deps.apiRequest<CreateJobResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: '/api/v1/jobs',
    stage: 'Create job request failed',
    retry: {
      attempts: NETWORK_RETRY_ATTEMPTS,
      delaysMs: NETWORK_RETRY_DELAYS_MS,
    },
    body: {
      tool_name: 'image.gemini_nb_remove_watermark',
      idempotency_key: deps.randomUUID(),
      input: {
        input_file_id: sourceFile.file_id,
      },
    },
  });
  const createdJob = createJobResponse.data.job;
  deps.progress.createdJob(createdJob.id);

  const shouldWait = args.wait || Boolean(args.output);

  if (!shouldWait) {
    return createdJob;
  }

  deps.progress.waitingForJob();
  deps.progress.jobStatus(createdJob.status);

  const job = isTerminalJobStatus(createdJob.status)
    ? createdJob
    : await deps.waitJobCommand({
        jobId: createdJob.id,
        baseUrl: args.baseUrl,
        token: args.token,
        timeoutSeconds: args.timeoutSeconds ?? 60,
        configPath: args.configPath,
        onStatus: (status) => {
          deps.progress.jobStatus(status);
        },
      });
  deps.progress.jobStatus(job.status);

  assertJobSucceeded(job);

  if (args.output) {
    const outputFileId = getOutputFileId(job);

    if (!outputFileId) {
      throw new Error('The watermark removal job did not produce an output file.');
    }

    deps.progress.downloadingOutput(outputFileId);
    await downloadOutputFile(
      {
        baseUrl: args.baseUrl,
        token: args.token,
        output: args.output,
      },
      outputFileId,
      deps,
    );
    deps.progress.savedOutput(args.output);
  }

  return job;
}
