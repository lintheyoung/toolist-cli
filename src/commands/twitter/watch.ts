import { createHash } from 'node:crypto';
import { exec } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { apiRequest } from '../../lib/http.js';
import { extendedNetworkRetryOptions, type RetryHandler } from '../../lib/retry.js';

export interface TwitterWatchPollRemoteCommandArgs {
  baseUrl: string;
  token: string;
  configPath?: string;
  remote: true;
  once: boolean;
  onRetry?: RetryHandler;
}

export interface TwitterWatchTrustCommandArgs {
  watchId: string;
  commandHash: string;
  configPath?: string;
  trustPath?: string;
}

export interface TwitterWatchTweetEvent {
  id: string;
  url?: string;
  text?: string;
  author?: {
    userName?: string;
  };
  createdAt?: string;
}

interface RemoteTwitterWatch {
  id: string;
  commandTemplate: string;
}

export interface TwitterWatchExecutionSummary {
  tweetId: string;
  tweetUrl?: string;
  commandHash: string;
  command: string;
  status: 'baseline_skipped' | 'skipped_untrusted' | 'success' | 'failed';
  requires_trust: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface TwitterWatchPollSummary {
  watchId: string;
  commandHash: string;
  baseline: boolean;
  eventCount: number;
  executions: TwitterWatchExecutionSummary[];
}

export interface TwitterWatchPollRemoteCommandResult {
  remote: true;
  once: boolean;
  watches: TwitterWatchPollSummary[];
  totals: {
    watches: number;
    events: number;
    executed: number;
    skipped: number;
    failed: number;
    requires_trust: number;
  };
}

export interface TwitterWatchTrustCommandResult {
  watchId: string;
  commandHash: string;
  trusted: true;
  trustPath: string;
}

interface TwitterWatchDependencies {
  apiRequest: typeof apiRequest;
  executeCommand: (command: string) => Promise<ExecutedCommand>;
  readTrustedCommands: (path?: string) => Promise<Set<string>>;
  writeTrustedCommands: (entries: Set<string>, path?: string) => Promise<string>;
}

interface ExecutedCommand {
  stdout: string;
  stderr: string;
  exitCode: number;
}

type RemoteWatchesResponse = {
  data?: {
    watches?: unknown;
  };
  watches?: unknown;
};

type PollWatchResponse = {
  data?: {
    watchId?: string;
    baseline?: boolean;
    events?: unknown;
  };
  watchId?: string;
  baseline?: boolean;
  events?: unknown;
};

function createDefaultDependencies(): TwitterWatchDependencies {
  return {
    apiRequest,
    executeCommand: executeLocalCommand,
    readTrustedCommands,
    writeTrustedCommands,
  };
}

export function createTwitterWatchCommandHash(commandTemplate: string): string {
  return createHash('sha256').update(commandTemplate, 'utf8').digest('hex');
}

function trustEntryKey(watchId: string, commandHash: string): string {
  return `${watchId}:${commandHash}`;
}

function getDefaultTrustPath(configPath?: string): string {
  if (configPath) {
    return join(dirname(configPath), 'twitter-watch-trust.json');
  }

  return join(homedir(), '.config', 'toollist', 'twitter-watch-trust.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeRemoteWatches(response: RemoteWatchesResponse): RemoteTwitterWatch[] {
  const watches = response.data?.watches ?? response.watches;

  if (!Array.isArray(watches)) {
    return [];
  }

  return watches.flatMap((watch): RemoteTwitterWatch[] => {
    if (!isRecord(watch)) {
      return [];
    }

    const id = getString(watch.id);
    const commandTemplate = getString(watch.commandTemplate)
      ?? getString(watch.command_template)
      ?? getString(watch.localCommandTemplate)
      ?? getString(watch.local_command_template);

    if (!id || !commandTemplate) {
      return [];
    }

    return [{ id, commandTemplate }];
  });
}

function normalizePollResponse(response: PollWatchResponse): {
  baseline: boolean;
  events: TwitterWatchTweetEvent[];
} {
  const data = response.data ?? response;
  const rawEvents = data.events;
  const events = Array.isArray(rawEvents)
    ? rawEvents.flatMap((event): TwitterWatchTweetEvent[] => {
      if (!isRecord(event)) {
        return [];
      }

      const rawTweet = isRecord(event.tweet) ? event.tweet : event;
      const id = getString(rawTweet.id);

      if (!id) {
        return [];
      }

      const author = isRecord(rawTweet.author) ? rawTweet.author : undefined;

      return [{
        id,
        url: getString(rawTweet.url),
        text: getString(rawTweet.text),
        author: author ? { userName: getString(author.userName) ?? getString(author.username) } : undefined,
        createdAt: getString(rawTweet.createdAt) ?? getString(rawTweet.created_at),
      }];
    })
    : [];

  return {
    baseline: data.baseline === true,
    events,
  };
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderCommandTemplate(commandTemplate: string, tweet: TwitterWatchTweetEvent): string {
  const replacements: Record<string, string> = {
    'tweet.id': tweet.id,
    'tweet.url': tweet.url ?? '',
    'tweet.text': tweet.text ?? '',
    'tweet.author.userName': tweet.author?.userName ?? '',
    'tweet.createdAt': tweet.createdAt ?? '',
  };

  return commandTemplate.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(replacements, key) ? shellQuote(replacements[key] ?? '') : match
  ));
}

async function executeLocalCommand(command: string): Promise<ExecutedCommand> {
  return new Promise((resolve) => {
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      const maybeExitError = error as NodeJS.ErrnoException | null;
      const exitCode = typeof maybeExitError?.code === 'number' ? maybeExitError.code : 0;

      resolve({
        stdout,
        stderr,
        exitCode,
      });
    });
  });
}

async function readTrustedCommands(path?: string): Promise<Set<string>> {
  const trustPath = path ?? getDefaultTrustPath();

  try {
    const parsed = JSON.parse(await readFile(trustPath, 'utf8')) as unknown;
    const entries = isRecord(parsed) && Array.isArray(parsed.trustedCommands)
      ? parsed.trustedCommands
      : [];

    return new Set(entries.flatMap((entry): string[] => {
      if (!isRecord(entry)) {
        return [];
      }

      const watchId = getString(entry.watchId);
      const commandHash = getString(entry.commandHash);

      return watchId && commandHash ? [trustEntryKey(watchId, commandHash)] : [];
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Set();
    }

    throw error;
  }
}

async function writeTrustedCommands(entries: Set<string>, path?: string): Promise<string> {
  const trustPath = path ?? getDefaultTrustPath();
  const trustedCommands = [...entries]
    .sort()
    .map((entry) => {
      const separatorIndex = entry.indexOf(':');
      return {
        watchId: entry.slice(0, separatorIndex),
        commandHash: entry.slice(separatorIndex + 1),
      };
    });
  const tempPath = join(dirname(trustPath), `.tmp-${randomUUID()}`);

  await mkdir(dirname(trustPath), { recursive: true });

  try {
    await writeFile(tempPath, `${JSON.stringify({ trustedCommands }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(tempPath, trustPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup failures; preserve the write error.
    }
    throw error;
  }

  return trustPath;
}

async function reportExecution(args: {
  deps: TwitterWatchDependencies;
  baseUrl: string;
  token: string;
  watchId: string;
  execution: TwitterWatchExecutionSummary;
  onRetry?: RetryHandler;
}): Promise<void> {
  await args.deps.apiRequest({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: `/api/cli/twitter/watch/${encodeURIComponent(args.watchId)}/executions`,
    body: {
      tweetId: args.execution.tweetId,
      tweetUrl: args.execution.tweetUrl,
      commandHash: args.execution.commandHash,
      command: args.execution.command,
      stdout: args.execution.stdout ?? '',
      stderr: args.execution.stderr ?? '',
      exitCode: args.execution.exitCode ?? null,
      status: args.execution.status,
    },
    stage: 'Twitter watch execution report failed',
    retry: extendedNetworkRetryOptions(args.onRetry),
  });
}

export async function twitterWatchPollRemoteCommand(
  args: TwitterWatchPollRemoteCommandArgs,
  dependencies: Partial<TwitterWatchDependencies> = {},
): Promise<TwitterWatchPollRemoteCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const trustedCommands = await deps.readTrustedCommands(getDefaultTrustPath(args.configPath));
  const watchesResponse = await deps.apiRequest<RemoteWatchesResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'GET',
    path: '/api/cli/twitter/watch/remote',
    stage: 'Twitter remote watches request failed',
    retry: extendedNetworkRetryOptions(args.onRetry),
  });
  const watches = normalizeRemoteWatches(watchesResponse);
  const watchSummaries: TwitterWatchPollSummary[] = [];

  for (const watch of watches) {
    const commandHash = createTwitterWatchCommandHash(watch.commandTemplate);
    const pollResponse = await deps.apiRequest<PollWatchResponse>({
      baseUrl: args.baseUrl,
      token: args.token,
      method: 'POST',
      path: `/api/cli/twitter/watch/${encodeURIComponent(watch.id)}/poll`,
      stage: 'Twitter watch poll request failed',
      retry: extendedNetworkRetryOptions(args.onRetry),
    });
    const pollResult = normalizePollResponse(pollResponse);
    const executions: TwitterWatchExecutionSummary[] = [];

    for (const event of pollResult.events) {
      const command = renderCommandTemplate(watch.commandTemplate, event);
      const baseExecution = {
        tweetId: event.id,
        tweetUrl: event.url,
        commandHash,
        command,
      };

      if (pollResult.baseline) {
        executions.push({
          ...baseExecution,
          status: 'baseline_skipped',
          requires_trust: false,
        });
        continue;
      }

      if (!trustedCommands.has(trustEntryKey(watch.id, commandHash))) {
        executions.push({
          ...baseExecution,
          status: 'skipped_untrusted',
          requires_trust: true,
        });
        continue;
      }

      const executed = await deps.executeCommand(command);
      const execution: TwitterWatchExecutionSummary = {
        ...baseExecution,
        status: executed.exitCode === 0 ? 'success' : 'failed',
        requires_trust: false,
        stdout: executed.stdout,
        stderr: executed.stderr,
        exitCode: executed.exitCode,
      };

      executions.push(execution);
      await reportExecution({
        deps,
        baseUrl: args.baseUrl,
        token: args.token,
        watchId: watch.id,
        execution,
        onRetry: args.onRetry,
      });
    }

    watchSummaries.push({
      watchId: watch.id,
      commandHash,
      baseline: pollResult.baseline,
      eventCount: pollResult.events.length,
      executions,
    });
  }

  const executions = watchSummaries.flatMap((watch) => watch.executions);

  return {
    remote: true,
    once: args.once,
    watches: watchSummaries,
    totals: {
      watches: watchSummaries.length,
      events: watchSummaries.reduce((total, watch) => total + watch.eventCount, 0),
      executed: executions.filter((execution) => execution.status === 'success' || execution.status === 'failed').length,
      skipped: executions.filter((execution) => execution.status === 'baseline_skipped' || execution.status === 'skipped_untrusted').length,
      failed: executions.filter((execution) => execution.status === 'failed').length,
      requires_trust: executions.filter((execution) => execution.requires_trust).length,
    },
  };
}

export async function twitterWatchTrustCommand(
  args: TwitterWatchTrustCommandArgs,
  dependencies: Partial<Pick<TwitterWatchDependencies, 'readTrustedCommands' | 'writeTrustedCommands'>> = {},
): Promise<TwitterWatchTrustCommandResult> {
  const deps = {
    readTrustedCommands,
    writeTrustedCommands,
    ...dependencies,
  };
  const trustPath = args.trustPath ?? getDefaultTrustPath(args.configPath);
  const trustedCommands = await deps.readTrustedCommands(trustPath);

  trustedCommands.add(trustEntryKey(args.watchId, args.commandHash));
  const writtenTrustPath = await deps.writeTrustedCommands(trustedCommands, trustPath);

  return {
    watchId: args.watchId,
    commandHash: args.commandHash,
    trusted: true,
    trustPath: writtenTrustPath,
  };
}
