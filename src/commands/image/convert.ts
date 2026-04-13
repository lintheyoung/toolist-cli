import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { apiRequest } from '../../lib/http.js';
import { uploadCommand } from '../files/upload.js';
import { waitJobCommand } from '../jobs/wait.js';

export interface ImageConvertCommandArgs {
  input: string;
  to: string;
  quality?: number;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl: string;
  token: string;
  configPath?: string;
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
  args: Pick<ImageConvertCommandArgs, 'baseUrl' | 'token' | 'output'>,
  outputFileId: string,
  dependencies: Pick<ImageConvertDependencies, 'fetch' | 'writeFile'>,
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

  const sourceFile = await deps.uploadCommand({
    input: args.input,
    baseUrl: args.baseUrl,
    token: args.token,
    configPath: args.configPath,
  });

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
    body: {
      tool_name: 'image.convert_format',
      idempotency_key: deps.randomUUID(),
      input,
    },
  });

  const shouldWait = args.wait || Boolean(args.output);

  if (!shouldWait) {
    return createJobResponse.data.job;
  }

  const job = await deps.waitJobCommand({
    jobId: createJobResponse.data.job.id,
    baseUrl: args.baseUrl,
    token: args.token,
    timeoutSeconds: args.timeoutSeconds ?? 60,
    configPath: args.configPath,
  });

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
      },
      outputFileId,
      deps,
    );
  }

  return job;
}
