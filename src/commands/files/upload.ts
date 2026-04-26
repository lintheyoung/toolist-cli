import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

import { apiRequest } from '../../lib/http.js';
import {
  extendedNetworkRetryOptions,
  type RetryHandler,
  withRetry,
} from '../../lib/retry.js';

export interface UploadFileCommandArgs {
  input: string;
  baseUrl: string;
  token: string;
  configPath?: string;
  computeSha256?: boolean;
  public?: boolean;
  onRetry?: RetryHandler;
}

export interface UploadFileCommandResult {
  file_id: string;
  upload_url: string;
  public_url?: string;
  headers: Record<string, string>;
  filename: string;
  mime_type: string;
  size_bytes: number;
  file: {
    fileId: string;
    status: string;
    [key: string]: unknown;
  };
}

export interface UploadFileDependencies {
  apiRequest: typeof apiRequest;
  readFile: typeof readFile;
  stat: typeof stat;
  fetch: typeof fetch;
}

type CreateUploadResponse = {
  data: {
    file_id: string;
    upload_url: string;
    public_url?: string;
    headers: Record<string, string>;
  };
  request_id: string;
};

type CompleteUploadResponse = {
  data: {
    file: UploadFileCommandResult['file'];
  };
  request_id: string;
};

const MIME_TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function isRetryableUploadResponse(response: Response): boolean {
  return response.status >= 500 && response.status <= 599;
}

function formatUploadResponseStatus(response: Response): string {
  const statusText = response.statusText.trim();
  return statusText ? `HTTP ${response.status} ${statusText}` : `HTTP ${response.status}`;
}

function createDefaultDependencies(): UploadFileDependencies {
  return {
    apiRequest,
    readFile,
    stat,
    fetch: globalThis.fetch.bind(globalThis),
  };
}

function inferMimeType(inputPath: string): string {
  const extension = extname(inputPath).toLowerCase();
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

export async function uploadCommand(
  args: UploadFileCommandArgs,
  dependencies: Partial<UploadFileDependencies> = {},
): Promise<UploadFileCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const filename = basename(args.input);
  const mimeType = inferMimeType(filename);
  const fileStats = await deps.stat(args.input);
  const fileBuffer = await deps.readFile(args.input);
  const sha256 = args.computeSha256
    ? createHash('sha256').update(fileBuffer).digest('hex')
    : undefined;
  const retry = extendedNetworkRetryOptions(args.onRetry);

  const createUploadResponse = await deps.apiRequest<CreateUploadResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: '/api/v1/files/create-upload',
    stage: 'Create upload request failed',
    retry,
    body: {
      filename,
      mime_type: mimeType,
      size_bytes: fileStats.size,
      ...(args.public ? { public: true } : {}),
    },
  });

  const uploadHeaders = {
    ...createUploadResponse.data.headers,
    'content-type': mimeType,
  };

  const uploadResponse = await withRetry({
    stage: 'Upload request failed',
    attempts: retry.attempts,
    delaysMs: retry.delaysMs,
    onRetry: retry.onRetry,
    fn: async () => {
      const response = await deps.fetch(createUploadResponse.data.upload_url, {
        method: 'PUT',
        headers: uploadHeaders,
        body: fileBuffer,
      });

      if (isRetryableUploadResponse(response)) {
        throw new Error(`upload responded with ${formatUploadResponseStatus(response)}`);
      }

      return response;
    },
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload ${filename} to the presigned URL.`);
  }

  const completeUploadResponse = await deps.apiRequest<CompleteUploadResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: `/api/v1/files/${encodeURIComponent(createUploadResponse.data.file_id)}/complete`,
    stage: 'Complete upload request failed',
    retry,
    ...(sha256 ? { body: { sha256 } } : {}),
  });

  return {
    ...createUploadResponse.data,
    filename,
    mime_type: mimeType,
    size_bytes: fileStats.size,
    file: completeUploadResponse.data.file,
  };
}
