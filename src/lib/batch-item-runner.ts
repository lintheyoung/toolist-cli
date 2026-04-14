import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { uploadCommand } from '../commands/files/upload.js';
import { waitJobCommand } from '../commands/jobs/wait.js';
import { apiRequest } from './http.js';
import { isCliError } from './errors.js';
import type { BatchManifest } from './batch-manifest.js';
import { saveBatchState, type BatchItemState, type BatchState } from './batch-state.js';

type CreateJobResponse = {
  data: {
    job: {
      id: string;
      status: string;
      result?: {
        output?: {
          outputFileId?: string;
          storageKey?: string;
        };
      } | null;
    };
  };
  request_id: string;
};

export type BatchItemExecutionResult = BatchItemState;

export interface BatchItemRunnerDependencies {
  apiRequest: typeof apiRequest;
  uploadCommand: typeof uploadCommand;
  waitJobCommand: typeof waitJobCommand;
  saveBatchState: typeof saveBatchState;
  fetch: typeof fetch;
  writeFile: typeof writeFile;
  mkdir: typeof mkdir;
  randomUUID: typeof randomUUID;
}

function createDefaultDependencies(): BatchItemRunnerDependencies {
  return {
    apiRequest,
    uploadCommand,
    waitJobCommand,
    saveBatchState,
    fetch: globalThis.fetch.bind(globalThis),
    writeFile,
    mkdir,
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

function toBatchStatus(jobStatus: string): BatchItemState['status'] {
  if (jobStatus === 'succeeded') {
    return 'succeeded';
  }

  if (jobStatus === 'failed' || jobStatus === 'canceled' || jobStatus === 'timed_out') {
    return 'failed';
  }

  return 'running';
}

function getOutputFileId(job: CreateJobResponse['data']['job']): string | null {
  const output = job.result?.output;

  if (!output || typeof output !== 'object') {
    return null;
  }

  return typeof output.outputFileId === 'string' ? output.outputFileId : null;
}

function getOutputFilename(job: CreateJobResponse['data']['job'], fallbackName: string): string {
  const output = job.result?.output;

  if (output && typeof output === 'object' && typeof output.storageKey === 'string') {
    const storageKeyFilename = basename(output.storageKey);

    if (storageKeyFilename) {
      return storageKeyFilename;
    }
  }

  const outputFileId = getOutputFileId(job);

  return outputFileId ?? fallbackName;
}

function buildDownloadUrl(baseUrl: string, fileId: string): string {
  return new URL(`/api/v1/files/${encodeURIComponent(fileId)}/download`, baseUrl).toString();
}

function formatError(error: unknown): BatchItemExecutionResult['error'] {
  if (isCliError(error)) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
    };
  }

  return {
    message: 'An unexpected error occurred.',
  };
}

async function downloadOutputFile(
  args: {
    baseUrl: string;
    token: string;
    outputPath: string;
  },
  outputFileId: string,
  dependencies: Pick<BatchItemRunnerDependencies, 'fetch' | 'writeFile' | 'mkdir'>,
): Promise<void> {
  await dependencies.mkdir(dirname(args.outputPath), { recursive: true });

  const response = await dependencies.fetch(buildDownloadUrl(args.baseUrl, outputFileId), {
    headers: {
      authorization: `Bearer ${args.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download output file ${outputFileId}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await dependencies.writeFile(args.outputPath, bytes);
}

export async function runBatchItem(
  args: {
    item: BatchManifest['items'][number];
    defaults: BatchManifest['defaults'] | undefined;
    credentials: {
      baseUrl: string;
      token: string;
    };
    state: BatchState;
    statePath: string;
  },
  dependencies: Partial<BatchItemRunnerDependencies> = {},
): Promise<BatchItemExecutionResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const existingStateItem = args.state.items[args.item.id];

  if (
    existingStateItem &&
    (existingStateItem.status === 'succeeded' || existingStateItem.status === 'skipped')
  ) {
    return existingStateItem;
  }

  const stateItem: BatchItemState = {
    ...(existingStateItem ?? {}),
    id: args.item.id,
    status: existingStateItem?.status ?? 'pending',
  };

  args.state.items[args.item.id] = stateItem;

  const updateState = async (
    patch: Partial<BatchItemExecutionResult>,
  ): Promise<BatchItemExecutionResult> => {
    Object.assign(stateItem, patch);
    args.state.items[args.item.id] = stateItem;
    await deps.saveBatchState(args.statePath, args.state);
    return stateItem;
  };

  try {
    await updateState({
      status: 'running',
      error: undefined,
      ...(existingStateItem?.status === 'failed'
        ? {
            output_file_id: undefined,
            output_path: undefined,
          }
        : {}),
    });

    const resumableJobId =
      stateItem.status === 'running' && typeof stateItem.job_id === 'string'
        ? stateItem.job_id
        : null;
    let sourceFileId =
      resumableJobId || args.item.input_path
        ? null
        : args.item.input_file_id ?? stateItem.uploaded_file_id ?? null;

    if (!resumableJobId && !sourceFileId && args.item.input_path) {
      const uploadedFile = await deps.uploadCommand({
        input: args.item.input_path,
        baseUrl: args.credentials.baseUrl,
        token: args.credentials.token,
        configPath: undefined,
      });

      sourceFileId = uploadedFile.file_id;
      await updateState({ uploaded_file_id: uploadedFile.file_id });
    }

    if (!resumableJobId && !sourceFileId) {
      throw new Error('Batch item must provide input_path or input_file_id.');
    }

    let job: CreateJobResponse['data']['job'];

    if (resumableJobId) {
      job = {
        id: resumableJobId,
        status: 'running',
      };
    } else {
      const createJobResponse = await deps.apiRequest<CreateJobResponse>({
        baseUrl: args.credentials.baseUrl,
        token: args.credentials.token,
        method: 'POST',
        path: '/api/v1/jobs',
        body: {
          tool_name: args.item.tool_name,
          idempotency_key: deps.randomUUID(),
          input: {
            ...args.item.input,
            input_file_id: sourceFileId,
          },
        },
      });

      job = createJobResponse.data.job;
      await updateState({
        job_id: job.id,
        status: toBatchStatus(job.status),
      });
    }

    if (args.defaults?.wait && !isTerminalJobStatus(job.status)) {
      job = await deps.waitJobCommand({
        jobId: job.id,
        baseUrl: args.credentials.baseUrl,
        token: args.credentials.token,
        timeoutSeconds: 60,
        configPath: undefined,
      });

      await updateState({
        status: toBatchStatus(job.status),
      });
    }

    const outputFileId = getOutputFileId(job);
    let outputPath: string | undefined;

    if (args.defaults?.download_outputs && outputFileId) {
      const outputDir = args.defaults.output_dir ?? process.cwd();
      outputPath = join(outputDir, getOutputFilename(job, args.item.id));

      await downloadOutputFile(
        {
          baseUrl: args.credentials.baseUrl,
          token: args.credentials.token,
          outputPath,
        },
        outputFileId,
        deps,
      );
    }

    return await updateState({
      status: toBatchStatus(job.status),
      ...(outputFileId ? { output_file_id: outputFileId } : {}),
      ...(outputPath ? { output_path: outputPath } : {}),
    });
  } catch (error) {
    return await updateState({
      status: 'failed',
      error: formatError(error),
    });
  }
}
