import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetchFileDownloadResponse } from '../../lib/download.js';
import { apiRequest } from '../../lib/http.js';
import type { ToolistEnvironment } from '../../lib/environments.js';
import { assertJobSucceeded, JobFailureError } from '../../lib/job-errors.js';
import {
  networkRetryOptions,
  type RetryHandler,
  withRetryHandler,
} from '../../lib/retry.js';
import {
  silentProgressReporter,
  type ProgressReporter,
} from '../../lib/progress-reporter.js';
import {
  createZipBatchInput,
  resolveZipBatchInputPaths,
  type CreateZipBatchInputResult,
} from '../../lib/zip-batch-input.js';
import { mergeChunkZipOutputs } from '../../lib/zip-merge.js';
import { uploadCommand } from '../files/upload.js';
import { waitJobCommand } from '../jobs/wait.js';

export const DEFAULT_REMOVE_WATERMARK_BATCH_CHUNK_SIZE = 5;
export const MAX_REMOVE_WATERMARK_BATCH_CHUNK_SIZE = 5;

export interface ImageRemoveWatermarkBatchCommandArgs {
  inputs?: string[];
  inputGlob?: string;
  chunkSize?: number;
  tuning?: ImageRemoveWatermarkBatchTuningInput;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  env?: ToolistEnvironment;
  baseUrl: string;
  token: string;
  configPath?: string;
  onRetry?: RetryHandler;
}

export interface ImageRemoveWatermarkBatchTuningInput {
  threshold?: number;
  region?: string;
  fallbackRegion?: string;
  snap?: boolean;
  snapMaxSize?: number;
  snapThreshold?: number;
  denoise?: 'ai' | 'ns' | 'telea' | 'soft' | 'off';
  sigma?: number;
  strength?: number;
  radius?: number;
  force?: boolean;
}

function buildHostedTuningInput(tuning: ImageRemoveWatermarkBatchTuningInput | undefined): Record<string, unknown> {
  if (!tuning) {
    return {};
  }

  return {
    ...('threshold' in tuning ? { threshold: tuning.threshold } : {}),
    ...('region' in tuning ? { region: tuning.region } : {}),
    ...('fallbackRegion' in tuning ? { fallback_region: tuning.fallbackRegion } : {}),
    ...('snap' in tuning ? { snap: tuning.snap } : {}),
    ...('snapMaxSize' in tuning ? { snap_max_size: tuning.snapMaxSize } : {}),
    ...('snapThreshold' in tuning ? { snap_threshold: tuning.snapThreshold } : {}),
    ...('denoise' in tuning ? { denoise: tuning.denoise } : {}),
    ...('sigma' in tuning ? { sigma: tuning.sigma } : {}),
    ...('strength' in tuning ? { strength: tuning.strength } : {}),
    ...('radius' in tuning ? { radius: tuning.radius } : {}),
    ...('force' in tuning ? { force: tuning.force } : {}),
  };
}

export interface ImageRemoveWatermarkBatchJobOutput {
  filename?: string;
  outputFileId?: string;
  mimeType?: string;
  storageKey?: string;
  [key: string]: unknown;
}

export interface ImageRemoveWatermarkBatchJobResult {
  id: string;
  status: string;
  toolName: string;
  toolVersion: string;
  input?: Record<string, unknown>;
  result?: {
    output?: ImageRemoveWatermarkBatchJobOutput;
    batch?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface ImageRemoveWatermarkBatchChunkSummary {
  index: number;
  jobId: string;
  inputCount: number;
  status: string;
}

export interface ImageRemoveWatermarkBatchCommandResult {
  chunks: ImageRemoveWatermarkBatchChunkSummary[];
  totalInputCount: number;
  processedFileCount: number;
  skippedFileCount: number;
  output?: string;
}

export interface ImageRemoveWatermarkBatchDependencies {
  apiRequest: typeof apiRequest;
  createZipBatchInput: typeof createZipBatchInput;
  resolveZipBatchInputPaths: typeof resolveZipBatchInputPaths;
  mergeChunkZipOutputs: typeof mergeChunkZipOutputs;
  uploadCommand: typeof uploadCommand;
  waitJobCommand: typeof waitJobCommand;
  fetch: typeof fetch;
  writeFile: typeof writeFile;
  randomUUID: typeof randomUUID;
  mkdtemp: typeof mkdtemp;
  rm: typeof rm;
  progress: ProgressReporter;
}

type CreateJobResponse = {
  data: {
    job: ImageRemoveWatermarkBatchJobResult;
  };
  request_id: string;
};

interface ImageRemoveWatermarkBatchInputChunk {
  index: number;
  total: number;
  inputPaths: string[];
  inputCount: number;
}

interface CompletedChunk {
  index: number;
  job: ImageRemoveWatermarkBatchJobResult;
  inputCount: number;
  processedFileCount?: number;
  skippedFileCount?: number;
  outputZipPath?: string;
}

class ChunkFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChunkFailureError';
  }
}

function createDefaultDependencies(): ImageRemoveWatermarkBatchDependencies {
  return {
    apiRequest,
    createZipBatchInput,
    resolveZipBatchInputPaths,
    mergeChunkZipOutputs,
    uploadCommand,
    waitJobCommand,
    fetch: globalThis.fetch.bind(globalThis),
    writeFile,
    randomUUID,
    mkdtemp,
    rm,
    progress: silentProgressReporter,
  };
}

async function cleanupOwnedTempDir(
  zipInput: CreateZipBatchInputResult,
  dependencies: Pick<ImageRemoveWatermarkBatchDependencies, 'rm'>,
): Promise<void> {
  if (!zipInput.cleanupPath) {
    return;
  }

  await dependencies.rm(zipInput.cleanupPath, { recursive: true, force: true });
}

function validateChunkSize(chunkSize: number): void {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('Invalid value for --chunk-size.');
  }

  if (chunkSize > MAX_REMOVE_WATERMARK_BATCH_CHUNK_SIZE) {
    throw new Error('--chunk-size cannot be greater than 5.');
  }
}

function splitIntoChunks(inputPaths: string[], chunkSize: number): ImageRemoveWatermarkBatchInputChunk[] {
  const chunks: ImageRemoveWatermarkBatchInputChunk[] = [];
  const total = Math.ceil(inputPaths.length / chunkSize);

  for (let offset = 0; offset < inputPaths.length; offset += chunkSize) {
    const inputPathsForChunk = inputPaths.slice(offset, offset + chunkSize);
    chunks.push({
      index: chunks.length + 1,
      total,
      inputPaths: inputPathsForChunk,
      inputCount: inputPathsForChunk.length,
    });
  }

  return chunks;
}

function isTerminalJobStatus(status: string): boolean {
  return (
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'canceled' ||
    status === 'timed_out'
  );
}

function getOutputFileId(job: ImageRemoveWatermarkBatchJobResult): string | null {
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

function getRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
  return field && typeof field === 'object' ? (field as Record<string, unknown>) : undefined;
}

function getNumberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

function getBatchCount(job: ImageRemoveWatermarkBatchJobResult, key: 'processedFileCount' | 'skippedFileCount'): number | undefined {
  const result = job.result && typeof job.result === 'object' ? job.result : undefined;
  const batch = getRecord(result, 'batch');
  const summary = getRecord(batch, 'summary');
  const snakeKey = key === 'processedFileCount' ? 'processed_file_count' : 'skipped_file_count';

  return (
    getNumberField(summary, key) ??
    getNumberField(summary, snakeKey) ??
    getNumberField(batch, key) ??
    getNumberField(batch, snakeKey)
  );
}

async function downloadOutputFile(
  args: Pick<ImageRemoveWatermarkBatchCommandArgs, 'baseUrl' | 'token' | 'onRetry'>,
  outputFileId: string,
  outputPath: string,
  dependencies: Pick<ImageRemoveWatermarkBatchDependencies, 'fetch' | 'writeFile'>,
): Promise<void> {
  const response = await fetchFileDownloadResponse({
    baseUrl: args.baseUrl,
    token: args.token,
    fileId: outputFileId,
    onRetry: args.onRetry,
  }, dependencies.fetch);

  if (!response.ok) {
    throw new Error(`Failed to download watermark batch output file ${outputFileId}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await dependencies.writeFile(outputPath, bytes);
}

function formatChunkJobFailure(chunk: ImageRemoveWatermarkBatchInputChunk, error: JobFailureError): ChunkFailureError {
  return new ChunkFailureError(
    [
      `Chunk failed: ${chunk.index}`,
      `Chunk input count: ${chunk.inputCount}`,
      error.message,
    ].join('\n'),
  );
}

function formatChunkGenericFailure(
  chunk: ImageRemoveWatermarkBatchInputChunk,
  error: unknown,
  job?: ImageRemoveWatermarkBatchJobResult,
): ChunkFailureError {
  const lines = [`Chunk failed: ${chunk.index}`, `Chunk input count: ${chunk.inputCount}`];

  if (job) {
    lines.push(`Job failed: ${job.id}`);
    lines.push(`Status: ${job.status}`);
  }

  lines.push(`Error message: ${error instanceof Error ? error.message : String(error)}`);
  return new ChunkFailureError(lines.join('\n'));
}

function buildCommandResult(
  chunks: CompletedChunk[],
  totalInputCount: number,
  output: string | undefined,
  processedFileCount: number,
  skippedFileCount: number,
): ImageRemoveWatermarkBatchCommandResult {
  return {
    chunks: chunks.map((chunk) => ({
      index: chunk.index,
      jobId: chunk.job.id,
      inputCount: chunk.inputCount,
      status: chunk.job.status,
    })),
    totalInputCount,
    processedFileCount,
    skippedFileCount,
    ...(output ? { output } : {}),
  };
}

async function createChunkJob(
  args: ImageRemoveWatermarkBatchCommandArgs,
  chunk: ImageRemoveWatermarkBatchInputChunk,
  dependencies: ImageRemoveWatermarkBatchDependencies,
): Promise<ImageRemoveWatermarkBatchJobResult> {
  const zipInput = await dependencies.createZipBatchInput({
    inputs: chunk.inputPaths,
  });

  try {
    dependencies.progress.uploadingInput();
    const sourceFile = await dependencies.uploadCommand(withRetryHandler({
      input: zipInput.zipPath,
      baseUrl: args.baseUrl,
      token: args.token,
      configPath: args.configPath,
      onRetry: args.onRetry,
    }, args.onRetry));
    dependencies.progress.uploadedFile(sourceFile.file_id);

    dependencies.progress.creatingJob();
    const input = {
      input_file_id: sourceFile.file_id,
      ...buildHostedTuningInput(args.tuning),
    };
    const createJobResponse = await dependencies.apiRequest<CreateJobResponse>({
      baseUrl: args.baseUrl,
      token: args.token,
      method: 'POST',
      path: '/api/v1/jobs',
      stage: 'Create job request failed',
      retry: networkRetryOptions(args.onRetry),
      body: {
        tool_name: 'image.gemini_nb_remove_watermark_batch',
        idempotency_key: dependencies.randomUUID(),
        input,
      },
    });
    const createdJob = createJobResponse.data.job;
    dependencies.progress.createdJob(createdJob.id);

    return createdJob;
  } finally {
    await cleanupOwnedTempDir(zipInput, dependencies);
  }
}

async function waitForChunkJob(
  args: ImageRemoveWatermarkBatchCommandArgs,
  chunk: ImageRemoveWatermarkBatchInputChunk,
  createdJob: ImageRemoveWatermarkBatchJobResult,
  dependencies: ImageRemoveWatermarkBatchDependencies,
): Promise<ImageRemoveWatermarkBatchJobResult> {
  dependencies.progress.waitingForJob();
  dependencies.progress.jobStatus(createdJob.status);

  const job = isTerminalJobStatus(createdJob.status)
    ? createdJob
    : await dependencies.waitJobCommand(withRetryHandler({
        jobId: createdJob.id,
        baseUrl: args.baseUrl,
        token: args.token,
        timeoutSeconds: args.timeoutSeconds ?? 60,
        configPath: args.configPath,
        onRetry: args.onRetry,
        onStatus: (status) => {
          dependencies.progress.jobStatus(status);
        },
      }, args.onRetry));
  dependencies.progress.jobStatus(job.status);

  try {
    assertJobSucceeded(job);
  } catch (error) {
    if (error instanceof JobFailureError) {
      throw formatChunkJobFailure(chunk, error);
    }

    throw error;
  }

  return job;
}

export async function imageRemoveWatermarkBatchCommand(
  args: ImageRemoveWatermarkBatchCommandArgs,
  dependencies: Partial<ImageRemoveWatermarkBatchDependencies> = {},
): Promise<ImageRemoveWatermarkBatchCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const chunkSize = args.chunkSize ?? DEFAULT_REMOVE_WATERMARK_BATCH_CHUNK_SIZE;
  validateChunkSize(chunkSize);

  const inputPaths = await deps.resolveZipBatchInputPaths({
    inputs: args.inputs,
    inputGlob: args.inputGlob,
  });

  if (inputPaths.length === 0) {
    throw new Error('Remove watermark batch requires at least one input.');
  }

  const chunks = splitIntoChunks(inputPaths, chunkSize);
  const shouldWait = args.wait || Boolean(args.output);
  const completedChunks: CompletedChunk[] = [];
  const outputTempDir = args.output
    ? await deps.mkdtemp(join(tmpdir(), 'toollist-watermark-batch-output-'))
    : undefined;

  try {
    for (const chunk of chunks) {
      let job: ImageRemoveWatermarkBatchJobResult | undefined;

      try {
        deps.progress.preparingChunk(chunk.index, chunk.total, chunk.inputCount);
        job = await createChunkJob(args, chunk, deps);
        job = shouldWait ? await waitForChunkJob(args, chunk, job, deps) : job;

        const completedChunk: CompletedChunk = {
          index: chunk.index,
          job,
          inputCount: chunk.inputCount,
          ...(shouldWait && getBatchCount(job, 'processedFileCount') !== undefined
            ? { processedFileCount: getBatchCount(job, 'processedFileCount') }
            : {}),
          ...(shouldWait && getBatchCount(job, 'skippedFileCount') !== undefined
            ? { skippedFileCount: getBatchCount(job, 'skippedFileCount') }
            : {}),
        };

        if (args.output) {
          const outputFileId = getOutputFileId(job);

          if (!outputFileId) {
            throw new Error('The watermark removal batch job did not produce an output file.');
          }

          const chunkOutputPath = join(outputTempDir!, `chunk-${String(chunk.index).padStart(3, '0')}.zip`);
          deps.progress.downloadingOutput(outputFileId);
          await downloadOutputFile(
            {
              baseUrl: args.baseUrl,
              token: args.token,
              onRetry: args.onRetry,
            },
            outputFileId,
            chunkOutputPath,
            deps,
          );
          deps.progress.savedChunkOutput(chunkOutputPath);
          completedChunk.outputZipPath = chunkOutputPath;
        }

        completedChunks.push(completedChunk);
      } catch (error) {
        if (error instanceof ChunkFailureError) {
          throw error;
        }

        throw formatChunkGenericFailure(chunk, error, job);
      }
    }

    if (args.output) {
      deps.progress.mergingChunkOutputs();
      const manifest = await deps.mergeChunkZipOutputs({
        outputPath: args.output,
        chunks: completedChunks.map((chunk) => ({
          index: chunk.index,
          jobId: chunk.job.id,
          inputCount: chunk.inputCount,
          status: chunk.job.status,
          zipPath: chunk.outputZipPath!,
          processedFileCount: chunk.processedFileCount,
          skippedFileCount: chunk.skippedFileCount,
        })),
      });
      deps.progress.savedOutput(args.output);

      return buildCommandResult(
        completedChunks,
        inputPaths.length,
        args.output,
        manifest.processedFileCount,
        manifest.skippedFileCount,
      );
    }

    return buildCommandResult(
      completedChunks,
      inputPaths.length,
      undefined,
      completedChunks.reduce((sum, chunk) => sum + (chunk.processedFileCount ?? 0), 0),
      completedChunks.reduce((sum, chunk) => sum + (chunk.skippedFileCount ?? 0), 0),
    );
  } finally {
    if (outputTempDir) {
      await deps.rm(outputTempDir, { recursive: true, force: true });
    }
  }
}
