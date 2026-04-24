import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { fetchFileDownloadResponse } from '../../lib/download.js';
import { apiRequest } from '../../lib/http.js';
import { assertJobSucceeded } from '../../lib/job-errors.js';
import {
  networkRetryOptions,
  type RetryHandler,
  withRetryHandler,
} from '../../lib/retry.js';
import { uploadCommand } from '../files/upload.js';
import { waitJobCommand } from '../jobs/wait.js';
import { assertSupportedConvertInputPath } from './convert-input-policy.js';

export interface ImageConvertCommandArgs {
  input: string;
  to: string;
  quality?: number;
  sync?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl: string;
  token: string;
  configPath?: string;
  onRetry?: RetryHandler;
}

export interface ImageConvertJobOutput {
  outputFileId?: string;
  mimeType?: string;
  storageKey?: string;
  [key: string]: unknown;
}

export interface ImageConvertJobResult {
  id: string;
  status: string;
  toolName: string;
  toolVersion: string;
  input?: Record<string, unknown>;
  result?: {
    output?: ImageConvertJobOutput;
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

function getOutputFileId(job: ImageConvertJobResult): string | null {
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

export interface ImageConvertDependencies {
  apiRequest: typeof apiRequest;
  uploadCommand: typeof uploadCommand;
  waitJobCommand: typeof waitJobCommand;
  assertSupportedConvertInputPath: typeof assertSupportedConvertInputPath;
  fetch: typeof fetch;
  writeFile: typeof writeFile;
  randomUUID: typeof randomUUID;
}

type CreateJobResponse = {
  data: {
    job: ImageConvertJobResult;
  };
  request_id: string;
};

const TARGET_MIME_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function createDefaultDependencies(): ImageConvertDependencies {
  return {
    apiRequest,
    uploadCommand,
    waitJobCommand,
    assertSupportedConvertInputPath,
    fetch: globalThis.fetch.bind(globalThis),
    writeFile,
    randomUUID,
  };
}

function normalizeTargetMimeType(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error('Missing required option: --to');
  }

  if (normalized.includes('/')) {
    return normalized;
  }

  const mimeType = TARGET_MIME_TYPES[normalized];

  if (!mimeType) {
    throw new Error(`Unsupported output format: ${value}`);
  }

  return mimeType;
}

async function downloadOutputFile(
  args: Pick<ImageConvertCommandArgs, 'baseUrl' | 'token' | 'output' | 'onRetry'>,
  outputFileId: string,
  dependencies: Pick<ImageConvertDependencies, 'fetch' | 'writeFile'>,
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
    throw new Error(`Failed to download converted file ${outputFileId}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await dependencies.writeFile(args.output, bytes);
}

export async function imageConvertCommand(
  args: ImageConvertCommandArgs,
  dependencies: Partial<ImageConvertDependencies> = {},
): Promise<ImageConvertJobResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  await deps.assertSupportedConvertInputPath(args.input);

  const sourceFile = await deps.uploadCommand(withRetryHandler({
    input: args.input,
    baseUrl: args.baseUrl,
    token: args.token,
    configPath: args.configPath,
    onRetry: args.onRetry,
  }, args.onRetry));

  const targetMimeType = normalizeTargetMimeType(args.to);
  const input: Record<string, unknown> = {
    input_file_id: sourceFile.file_id,
    target_mime_type: targetMimeType,
  };

  if (args.quality !== undefined) {
    input.quality = args.quality;
  }

  const createJobResponse = await deps.apiRequest<CreateJobResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: '/api/v1/jobs',
    stage: 'Create job request failed',
    retry: networkRetryOptions(args.onRetry),
    body: {
      tool_name: 'image.convert_format',
      ...(args.sync ? { execution_mode: 'sync' as const } : {}),
      idempotency_key: deps.randomUUID(),
      input,
    },
  });

  const shouldWait = args.wait || Boolean(args.output);

  if (!shouldWait) {
    return createJobResponse.data.job;
  }

  const job = isTerminalJobStatus(createJobResponse.data.job.status)
    ? createJobResponse.data.job
    : await deps.waitJobCommand(withRetryHandler({
        jobId: createJobResponse.data.job.id,
        baseUrl: args.baseUrl,
        token: args.token,
        timeoutSeconds: args.timeoutSeconds ?? 60,
        configPath: args.configPath,
        onRetry: args.onRetry,
      }, args.onRetry));

  assertJobSucceeded(job);

  if (args.output) {
    const outputFileId = getOutputFileId(job);

    if (!outputFileId) {
      throw new Error('The conversion job did not produce an output file.');
    }

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
  }

  return job;
}
