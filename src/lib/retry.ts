export const NETWORK_RETRY_ATTEMPTS = 3;
export const NETWORK_RETRY_DELAYS_MS = [1000, 3000] as const;

export type RetryOptions = {
  attempts: number;
  delaysMs: readonly number[];
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

  return new Error(`${stage}: ${message}`);
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
      await sleep(delayMs);
    }
  }

  throw withStagePrefix(args.stage, lastError);
}
