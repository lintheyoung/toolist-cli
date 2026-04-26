import { apiRequest } from './http.js';
import { isCliError } from './errors.js';
import {
  isRetryableTransportError,
  networkRetryOptions,
  withRetry,
  type RetryHandler,
} from './retry.js';

export const DEFAULT_OUTPUT_FILE_ID_TIMEOUT_MS = 45_000;
export const DEFAULT_OUTPUT_FILE_ID_POLL_INTERVAL_MS = 1_000;

export interface JobWithOutputFile {
  id: string;
  status: string;
  result?: {
    output?: {
      outputFileId?: unknown;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

type GetJobResponse<TJob extends JobWithOutputFile> = {
  data: {
    job: TJob;
  };
  request_id: string;
};

export interface WaitForOutputFileIdArgs<TJob extends JobWithOutputFile> {
  job: TJob;
  baseUrl: string;
  token: string;
  configPath?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  onRetry?: RetryHandler;
}

export interface WaitForOutputFileIdResult<TJob extends JobWithOutputFile> {
  outputFileId: string | null;
  job: TJob;
}

export interface WaitForOutputFileIdDependencies {
  apiRequest: typeof apiRequest;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDefaultDependencies(): WaitForOutputFileIdDependencies {
  return {
    apiRequest,
    sleep: defaultSleep,
    now: () => Date.now(),
  };
}

export function getJobOutputFileId(job: JobWithOutputFile): string | null {
  if (!job.result || typeof job.result !== 'object') {
    return null;
  }

  const output = job.result.output;

  if (!output || typeof output !== 'object') {
    return null;
  }

  return typeof output.outputFileId === 'string' ? output.outputFileId : null;
}

function isRetryableOutputLookupError(error: unknown): boolean {
  if (isCliError(error)) {
    return error.status >= 500;
  }

  return isRetryableTransportError(error);
}

async function refreshJob<TJob extends JobWithOutputFile>(
  args: WaitForOutputFileIdArgs<TJob>,
  dependencies: WaitForOutputFileIdDependencies,
  getRemainingMs: () => number,
): Promise<TJob> {
  const retry = networkRetryOptions(args.onRetry);

  return withRetry({
    stage: 'Output file lookup failed',
    attempts: retry.attempts,
    delaysMs: retry.delaysMs,
    onRetry: retry.onRetry,
    sleep: async (ms) => {
      const remainingMs = getRemainingMs();
      await dependencies.sleep(Math.max(0, Math.min(ms, remainingMs)));
    },
    shouldRetry: (error) => getRemainingMs() > 0 && isRetryableOutputLookupError(error),
    fn: async () => {
      const response = await dependencies.apiRequest<GetJobResponse<TJob>>({
        baseUrl: args.baseUrl,
        token: args.token,
        method: 'GET',
        path: `/api/v1/jobs/${encodeURIComponent(args.job.id)}`,
        stage: 'Output file lookup failed',
      });

      return response.data.job;
    },
  });
}

export async function waitForOutputFileId<TJob extends JobWithOutputFile>(
  args: WaitForOutputFileIdArgs<TJob>,
  dependencies: Partial<WaitForOutputFileIdDependencies> = {},
): Promise<WaitForOutputFileIdResult<TJob>> {
  const currentOutputFileId = getJobOutputFileId(args.job);

  if (currentOutputFileId) {
    return {
      outputFileId: currentOutputFileId,
      job: args.job,
    };
  }

  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const timeoutMs = Math.max(0, args.timeoutMs ?? DEFAULT_OUTPUT_FILE_ID_TIMEOUT_MS);
  const pollIntervalMs = Math.max(1, args.pollIntervalMs ?? DEFAULT_OUTPUT_FILE_ID_POLL_INTERVAL_MS);
  const deadline = deps.now() + timeoutMs;
  let lastJob = args.job;
  const getRemainingMs = () => Math.max(0, deadline - deps.now());

  while (getRemainingMs() > 0) {
    lastJob = await refreshJob(args, deps, getRemainingMs);

    const outputFileId = getJobOutputFileId(lastJob);

    if (outputFileId) {
      return {
        outputFileId,
        job: lastJob,
      };
    }

    const remainingMs = getRemainingMs();

    if (remainingMs <= 0) {
      break;
    }

    const delayMs = Math.min(pollIntervalMs, remainingMs);
    await deps.sleep(delayMs);
  }

  return {
    outputFileId: null,
    job: lastJob,
  };
}
