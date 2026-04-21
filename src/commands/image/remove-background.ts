import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { apiRequest } from '../../lib/http.js';
import { assertJobSucceeded } from '../../lib/job-errors.js';
import { uploadCommand } from '../files/upload.js';
import { waitJobCommand } from '../jobs/wait.js';

export interface ImageRemoveBackgroundCommandArgs {
  input: string;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl: string;
  token: string;
  configPath?: string;
}

export interface ImageRemoveBackgroundJobOutput {
  outputFileId?: string;
  mimeType?: string;
  storageKey?: string;
  [key: string]: unknown;
}

export interface ImageRemoveBackgroundJobResult {
  id: string;
  status: string;
  toolName: string;
  toolVersion: string;
  input?: Record<string, unknown>;
  result?: {
    output?: ImageRemoveBackgroundJobOutput;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface ImageRemoveBackgroundDependencies {
  apiRequest: typeof apiRequest;
  uploadCommand: typeof uploadCommand;
  waitJobCommand: typeof waitJobCommand;
  fetch: typeof fetch;
  writeFile: typeof writeFile;
  randomUUID: typeof randomUUID;
}

type CreateJobResponse = {
  data: {
    job: ImageRemoveBackgroundJobResult;
  };
  request_id: string;
};

function createDefaultDependencies(): ImageRemoveBackgroundDependencies {
  return {
    apiRequest,
    uploadCommand,
    waitJobCommand,
    fetch: globalThis.fetch.bind(globalThis),
    writeFile,
    randomUUID,
  };
}

function isTerminalJobStatus(status: string): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'canceled' ||
    status === 'timed_out'
  );
}

function getOutputFileId(job: ImageRemoveBackgroundJobResult): string | null {
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

function buildDownloadUrl(baseUrl: string, fileId: string): string {
  return new URL(`/api/v1/files/${encodeURIComponent(fileId)}/download`, baseUrl).toString();
}

async function downloadOutputFile(
  args: Pick<ImageRemoveBackgroundCommandArgs, 'baseUrl' | 'token' | 'output'>,
  outputFileId: string,
  dependencies: Pick<ImageRemoveBackgroundDependencies, 'fetch' | 'writeFile'>,
): Promise<void> {
  if (!args.output) {
    return;
  }

  const response = await dependencies.fetch(buildDownloadUrl(args.baseUrl, outputFileId), {
    headers: {
      authorization: `Bearer ${args.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download background-removed file ${outputFileId}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await dependencies.writeFile(args.output, bytes);
}

export async function imageRemoveBackgroundCommand(
  args: ImageRemoveBackgroundCommandArgs,
  dependencies: Partial<ImageRemoveBackgroundDependencies> = {},
): Promise<ImageRemoveBackgroundJobResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const sourceFile = await deps.uploadCommand({
    input: args.input,
    baseUrl: args.baseUrl,
    token: args.token,
    configPath: args.configPath,
  });

  const createJobResponse = await deps.apiRequest<CreateJobResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: '/api/v1/jobs',
    body: {
      tool_name: 'image.remove_background',
      idempotency_key: deps.randomUUID(),
      input: {
        input_file_id: sourceFile.file_id,
      },
    },
  });

  const shouldWait = args.wait || Boolean(args.output);

  if (!shouldWait) {
    return createJobResponse.data.job;
  }

  const job = isTerminalJobStatus(createJobResponse.data.job.status)
    ? createJobResponse.data.job
    : await deps.waitJobCommand({
        jobId: createJobResponse.data.job.id,
        baseUrl: args.baseUrl,
        token: args.token,
        timeoutSeconds: args.timeoutSeconds ?? 60,
        configPath: args.configPath,
      });

  assertJobSucceeded(job);

  if (args.output) {
    const outputFileId = getOutputFileId(job);

    if (!outputFileId) {
      throw new Error('The background removal job did not produce an output file.');
    }

    await downloadOutputFile(
      {
        baseUrl: args.baseUrl,
        token: args.token,
        output: args.output,
      },
      outputFileId,
      deps,
    );
  }

  return job;
}
