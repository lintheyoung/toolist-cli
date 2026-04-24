import { CliError, isCliError } from './errors.js';

export const NETWORK_RETRY_ATTEMPTS = 3;
export const NETWORK_RETRY_DELAYS_MS = [1000, 3000] as const;
export const EXTENDED_NETWORK_RETRY_ATTEMPTS = 4;
export const EXTENDED_NETWORK_RETRY_DELAYS_MS = [1000, 3000, 7000] as const;

export type RetryEvent = {
  stage: string;
  error: unknown;
  retryAttempt: number;
  maxAttempts: number;
  delayMs: number;
};

export type RetryHandler = (event: RetryEvent) => void | Promise<void>;

export type RetryOptions = {
  attempts: number;
  delaysMs: readonly number[];
  onRetry?: RetryHandler;
};

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withStagePrefix(stage: string, error: unknown): Error {
  const message = formatErrorMessage(error);

  if (message.startsWith(`${stage}: `)) {
    return error instanceof Error ? error : new Error(message);
  }

  if (isCliError(error)) {
    return new CliError({
      code: error.code,
      message: `${stage}: ${message}`,
      status: error.status,
      details: error.details,
      requestId: error.requestId,
    });
  }

  return new Error(`${stage}: ${message}`);
}

function hasStringProperty(value: unknown, property: string): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    property in value &&
    typeof (value as Record<string, unknown>)[property] === 'string'
  );
}

function collectErrorCandidates(error: unknown): unknown[] {
  const candidates: unknown[] = [];
  let current: unknown = error;

  while (current && typeof current === 'object') {
    candidates.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  if (candidates.length === 0) {
    candidates.push(error);
  }

  return candidates;
}

export function isRetryableTransportError(error: unknown): boolean {
  for (const candidate of collectErrorCandidates(error)) {
    const code = hasStringProperty(candidate, 'code') ? candidate.code : undefined;

    if (
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      code === 'EAI_AGAIN' ||
      code === 'ENOTFOUND' ||
      code === 'EPIPE' ||
      code?.startsWith('UND_ERR_')
    ) {
      return true;
    }

    const message = formatErrorMessage(candidate).toLowerCase();

    if (
      message.includes('fetch failed') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('eai_again') ||
      message.includes('und_err_')
    ) {
      return true;
    }
  }

  return false;
}

function retryActionFromStage(stage: string): string {
  return stage.replace(/\s+failed$/i, '').toLowerCase();
}

export function createStderrRetryReporter(write: (chunk: string) => void): RetryHandler {
  return (event) => {
    write(`${event.stage}: ${formatErrorMessage(event.error)}\n`);
    write(
      `Retrying ${retryActionFromStage(event.stage)} ` +
      `(${event.retryAttempt}/${event.maxAttempts}) in ${event.delayMs}ms...\n`,
    );
  };
}

export function withRetryHandler<T extends object>(
  args: T,
  onRetry?: RetryHandler,
): T & { onRetry?: RetryHandler } {
  if (!onRetry) {
    return args;
  }

  return Object.defineProperty(args, 'onRetry', {
    value: onRetry,
    enumerable: false,
    configurable: true,
  }) as T & { onRetry: RetryHandler };
}

export function networkRetryOptions(onRetry?: RetryHandler): RetryOptions {
  return withRetryHandler({
    attempts: NETWORK_RETRY_ATTEMPTS,
    delaysMs: NETWORK_RETRY_DELAYS_MS,
  }, onRetry);
}

export function extendedNetworkRetryOptions(onRetry?: RetryHandler): RetryOptions {
  return withRetryHandler({
    attempts: EXTENDED_NETWORK_RETRY_ATTEMPTS,
    delaysMs: EXTENDED_NETWORK_RETRY_DELAYS_MS,
  }, onRetry);
}

export async function withStageContext<T>(
  stage: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw withStagePrefix(stage, error);
  }
}

export async function withRetry<T>(args: {
  stage: string;
  attempts: number;
  delaysMs: readonly number[];
  fn: () => Promise<T>;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: RetryHandler;
}): Promise<T> {
  const attempts = Math.max(1, Math.floor(args.attempts));
  const sleep = args.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attemptIndex = 0; attemptIndex < attempts; attemptIndex += 1) {
    try {
      return await args.fn();
    } catch (error) {
      lastError = error;

      if (args.shouldRetry && !args.shouldRetry(error)) {
        throw withStagePrefix(args.stage, error);
      }

      if (attemptIndex === attempts - 1) {
        break;
      }

      const delayMs =
        args.delaysMs[attemptIndex] ?? args.delaysMs[args.delaysMs.length - 1] ?? 0;
      await args.onRetry?.({
        stage: args.stage,
        error,
        retryAttempt: attemptIndex + 1,
        maxAttempts: attempts,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw withStagePrefix(args.stage, lastError);
}
