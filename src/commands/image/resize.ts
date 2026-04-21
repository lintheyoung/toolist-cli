import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { apiRequest } from '../../lib/http.js';
import { assertJobSucceeded } from '../../lib/job-errors.js';
import { uploadCommand } from '../files/upload.js';
import { waitJobCommand } from '../jobs/wait.js';

export interface ImageResizeCommandArgs {
  input: string;
  width?: number;
  height?: number;
  to?: string;
  quality?: number;
  sync?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl: string;
  token: string;
  configPath?: string;
}

export interface ImageResizeJobOutput {
  outputFileId?: string;
  mimeType?: string;
  storageKey?: string;
  [key: string]: unknown;
}

export interface ImageResizeJobResult {
  id: string;
  status: string;
  toolName: string;
  toolVersion: string;
  input?: Record<string, unknown>;
  result?: {
    output?: ImageResizeJobOutput;
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

function getOutputFileId(job: ImageResizeJobResult): string | null {
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

export interface ImageResizeDependencies {
  apiRequest: typeof apiRequest;
  uploadCommand: typeof uploadCommand;
  waitJobCommand: typeof waitJobCommand;
  fetch: typeof fetch;
  writeFile: typeof writeFile;
  randomUUID: typeof randomUUID;
}

type CreateJobResponse = {
  data: {
    job: ImageResizeJobResult;
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

function createDefaultDependencies(): ImageResizeDependencies {
  return {
    apiRequest,
    uploadCommand,
    waitJobCommand,
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

function buildDownloadUrl(baseUrl: string, fileId: string): string {
  return new URL(`/api/v1/files/${encodeURIComponent(fileId)}/download`, baseUrl).toString();
}

async function downloadOutputFile(
  args: Pick<ImageResizeCommandArgs, 'baseUrl' | 'token' | 'output'>,
  outputFileId: string,
  dependencies: Pick<ImageResizeDependencies, 'fetch' | 'writeFile'>,
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
    throw new Error(`Failed to download resized file ${outputFileId}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await dependencies.writeFile(args.output, bytes);
}

export async function imageResizeCommand(
  args: ImageResizeCommandArgs,
  dependencies: Partial<ImageResizeDependencies> = {},
): Promise<ImageResizeJobResult> {
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

  const input: Record<string, unknown> = {
    input_file_id: sourceFile.file_id,
  };

  if (args.width !== undefined) {
    input.width = args.width;
  }

  if (args.height !== undefined) {
    input.height = args.height;
  }

  if (args.to !== undefined) {
    input.target_mime_type = normalizeTargetMimeType(args.to);
  }

  if (args.quality !== undefined) {
    input.quality = args.quality;
  }

  const createJobResponse = await deps.apiRequest<CreateJobResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: '/api/v1/jobs',
    body: {
      tool_name: 'image.resize',
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
      throw new Error('The resize job did not produce an output file.');
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
