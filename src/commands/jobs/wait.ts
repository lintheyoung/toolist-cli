import { getJobCommand, type GetJobCommandArgs, type GetJobCommandResult } from './get.js';

export interface WaitJobCommandArgs extends GetJobCommandArgs {
  timeoutSeconds: number;
}

export interface WaitJobDependencies {
  getJob: typeof getJobCommand;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  pollIntervalMs: number;
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'canceled', 'timed_out']);

function createDefaultDependencies(): WaitJobDependencies {
  return {
    getJob: getJobCommand,
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    now: () => Date.now(),
    pollIntervalMs: 2000,
  };
}

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

function createTimeoutError(jobId: string, timeoutSeconds: number): Error {
  return new Error(`Timed out waiting for job ${jobId} after ${timeoutSeconds} seconds.`);
}

export async function waitJobCommand(
  args: WaitJobCommandArgs,
  dependencies: Partial<WaitJobDependencies> = {},
): Promise<GetJobCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const startedAt = deps.now();
  const timeoutMs = args.timeoutSeconds * 1000;
  const deadline = startedAt + timeoutMs;

  while (true) {
    const now = deps.now();

    if (now >= deadline) {
      throw createTimeoutError(args.jobId, args.timeoutSeconds);
    }

    const job = await deps.getJob({
      jobId: args.jobId,
      baseUrl: args.baseUrl,
      token: args.token,
      configPath: args.configPath,
    });

    if (isTerminalStatus(job.status)) {
      if (deps.now() >= deadline) {
        throw createTimeoutError(args.jobId, args.timeoutSeconds);
      }
      return job;
    }

    const remainingMs = deadline - deps.now();

    if (remainingMs <= 0) {
      throw createTimeoutError(args.jobId, args.timeoutSeconds);
    }

    await deps.sleep(Math.min(deps.pollIntervalMs, remainingMs));
  }
}
