import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { fetchFileDownloadResponse } from '../../lib/download.js';
import { apiRequest } from '../../lib/http.js';
import { assertJobSucceeded } from '../../lib/job-errors.js';
import {
  getJobOutputFileId,
  waitForOutputFileId,
} from '../../lib/job-output.js';
import {
  networkRetryOptions,
  type RetryHandler,
  withRetryHandler,
} from '../../lib/retry.js';
import {
  silentProgressReporter,
  type ProgressReporter,
} from '../../lib/progress-reporter.js';
import { waitJobCommand } from '../jobs/wait.js';

export const GPT_IMAGE_2_TOOL_NAME = 'image.gpt_image_2_text_to_image';
export const DEFAULT_GPT_IMAGE_2_ASPECT_RATIO = 'auto';

export interface ImageGptImage2CommandArgs {
  prompt: string;
  aspectRatio?: string;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl: string;
  token: string;
  configPath?: string;
  onRetry?: RetryHandler;
}

export interface ImageGptImage2JobOutput {
  outputFileId?: string;
  mimeType?: string;
  storageBucket?: string;
  storageKey?: string;
  [key: string]: unknown;
}

export interface ImageGptImage2JobResult {
  id: string;
  status: string;
  toolName: string;
  toolVersion: string;
  input?: Record<string, unknown>;
  result?: {
    output?: ImageGptImage2JobOutput;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface ImageGptImage2Dependencies {
  apiRequest: typeof apiRequest;
  waitJobCommand: typeof waitJobCommand;
  waitForOutputFileId: typeof waitForOutputFileId<ImageGptImage2JobResult>;
  fetch: typeof fetch;
  writeFile: typeof writeFile;
  randomUUID: typeof randomUUID;
  progress: ProgressReporter;
}

type CreateJobResponse = {
  data: {
    job: ImageGptImage2JobResult;
  };
  request_id: string;
};

function createDefaultDependencies(): ImageGptImage2Dependencies {
  return {
    apiRequest,
    waitJobCommand,
    waitForOutputFileId,
    fetch: globalThis.fetch.bind(globalThis),
    writeFile,
    randomUUID,
    progress: silentProgressReporter,
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

async function downloadOutputFile(
  args: Pick<ImageGptImage2CommandArgs, 'baseUrl' | 'token' | 'output' | 'onRetry'>,
  outputFileId: string,
  dependencies: Pick<ImageGptImage2Dependencies, 'fetch' | 'writeFile'>,
): Promise<void> {
  if (!args.output) {
    return;
  }

  const response = await fetchFileDownloadResponse({
    baseUrl: args.baseUrl,
    token: args.token,
    fileId: outputFileId,
    onRetry: args.onRetry,
  }, dependencies.fetch);

  if (!response.ok) {
    throw new Error(`Failed to download GPT Image 2 output file ${outputFileId}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await dependencies.writeFile(args.output, bytes);
}

export async function imageGptImage2Command(
  args: ImageGptImage2CommandArgs,
  dependencies: Partial<ImageGptImage2Dependencies> = {},
): Promise<ImageGptImage2JobResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  deps.progress.creatingJob();
  const createJobResponse = await deps.apiRequest<CreateJobResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: '/api/v1/jobs',
    stage: 'Create job request failed',
    retry: networkRetryOptions(args.onRetry),
    body: {
      tool_name: GPT_IMAGE_2_TOOL_NAME,
      idempotency_key: deps.randomUUID(),
      input: {
        prompt: args.prompt,
        aspect_ratio: args.aspectRatio ?? DEFAULT_GPT_IMAGE_2_ASPECT_RATIO,
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

  let job = isTerminalJobStatus(createdJob.status)
    ? createdJob
    : await deps.waitJobCommand(withRetryHandler({
        jobId: createdJob.id,
        baseUrl: args.baseUrl,
        token: args.token,
        timeoutSeconds: args.timeoutSeconds ?? 60,
        configPath: args.configPath,
        onRetry: args.onRetry,
        onStatus: (status) => {
          deps.progress.jobStatus(status);
        },
      }, args.onRetry));
  deps.progress.jobStatus(job.status);

  assertJobSucceeded(job);

  if (args.output) {
    let outputFileId = getJobOutputFileId(job);

    if (!outputFileId) {
      const outputLookup = await deps.waitForOutputFileId(withRetryHandler({
        job,
        baseUrl: args.baseUrl,
        token: args.token,
        configPath: args.configPath,
        onRetry: args.onRetry,
      }, args.onRetry));
      outputFileId = outputLookup.outputFileId;
      job = outputLookup.job;
    }

    if (!outputFileId) {
      throw new Error('The GPT Image 2 job did not produce an output file.');
    }

    deps.progress.downloadingOutput(outputFileId);
    await downloadOutputFile(
      {
        baseUrl: args.baseUrl,
        token: args.token,
        output: args.output,
        onRetry: args.onRetry,
      },
      outputFileId,
      deps,
    );
    deps.progress.savedOutput(args.output);
  }

  return job;
}
