import { hostname } from 'node:os';

import { apiRequest } from '../../lib/http.js';
import {
  extendedNetworkRetryOptions,
  formatErrorMessage,
  type RetryHandler,
} from '../../lib/retry.js';
import {
  checkWeClawHealth,
  DEFAULT_WECLAW_URL,
  sendWeClawLocalMessage,
} from '../../lib/weclaw-local.js';

export const DEFAULT_WECLAW_RELAY_INTERVAL_SECONDS = 10;
export const DEFAULT_WECLAW_RELAY_LIMIT = 10;

export interface WeClawRelayCommandArgs {
  baseUrl: string;
  token: string;
  weclawUrl?: string;
  once: boolean;
  limit?: number;
  intervalSeconds?: number;
  relayId?: string;
  stopSignal?: AbortSignal;
  onRetry?: RetryHandler;
}

export interface WeClawDeliveryResult {
  id: string;
  targetUserId: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
}

export interface WeClawRelayCommandResult {
  ok: boolean;
  once: boolean;
  relayId: string;
  weclawUrl: string;
  claimed: number;
  sent: number;
  failed: number;
  cycles: number;
  deliveries: WeClawDeliveryResult[];
}

export interface WeClawRelayDependencies {
  apiRequest: typeof apiRequest;
  checkWeClawHealth: typeof checkWeClawHealth;
  sendWeClawLocalMessage: typeof sendWeClawLocalMessage;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  progress: (message: string) => void;
  createRelayId: () => string;
}

interface WeClawDelivery {
  id: string;
  targetUserId: string;
  text?: string;
  mediaUrl?: string;
}

type ClaimResponse = {
  data?: unknown;
} & Record<string, unknown>;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

function createDefaultRelayId(): string {
  return `${hostname() || 'toolist'}-${process.pid}`;
}

function createDefaultDependencies(): WeClawRelayDependencies {
  return {
    apiRequest,
    checkWeClawHealth,
    sendWeClawLocalMessage,
    sleep: defaultSleep,
    progress: () => {},
    createRelayId: createDefaultRelayId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function normalizeDeliveries(response: ClaimResponse): WeClawDelivery[] {
  const data = isRecord(response.data) ? response.data : response;
  const rawDeliveries = data.deliveries;

  if (!Array.isArray(rawDeliveries)) {
    return [];
  }

  return rawDeliveries.flatMap((delivery): WeClawDelivery[] => {
    if (!isRecord(delivery)) {
      return [];
    }

    const id = getString(delivery, 'id');
    const targetUserId = getString(delivery, 'to', 'targetUserId', 'target_user_id');

    if (!id || !targetUserId) {
      return [];
    }

    return [{
      id,
      targetUserId,
      text: getString(delivery, 'text'),
      mediaUrl: getString(delivery, 'mediaUrl', 'media_url'),
    }];
  });
}

function mergeCycleResult(
  summary: WeClawRelayCommandResult,
  cycle: {
    claimed: number;
    sent: number;
    failed: number;
    deliveries: WeClawDeliveryResult[];
  },
): void {
  summary.claimed += cycle.claimed;
  summary.sent += cycle.sent;
  summary.failed += cycle.failed;
  summary.deliveries.push(...cycle.deliveries);
}

async function ackDelivery(args: {
  deps: WeClawRelayDependencies;
  baseUrl: string;
  token: string;
  deliveryId: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
  onRetry?: RetryHandler;
}): Promise<void> {
  const body: {
    status: 'sent' | 'failed';
    errorMessage?: string;
  } = {
    status: args.status,
  };

  if (args.errorMessage !== undefined) {
    body.errorMessage = args.errorMessage;
  }

  await args.deps.apiRequest({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: `/api/v1/weclaw-deliveries/${encodeURIComponent(args.deliveryId)}/ack`,
    body,
    stage: 'WeClaw delivery ack failed',
    retry: extendedNetworkRetryOptions(args.onRetry),
  });
}

async function runRelayCycle(args: {
  deps: WeClawRelayDependencies;
  baseUrl: string;
  token: string;
  weclawUrl: string;
  limit: number;
  relayId: string;
  onRetry?: RetryHandler;
}): Promise<{
  claimed: number;
  sent: number;
  failed: number;
  deliveries: WeClawDeliveryResult[];
}> {
  args.deps.progress('Claiming deliveries...');
  const claimResponse = await args.deps.apiRequest<ClaimResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: '/api/v1/weclaw-deliveries/claim',
    body: {
      limit: args.limit,
      relayId: args.relayId,
    },
    stage: 'WeClaw delivery claim failed',
    retry: extendedNetworkRetryOptions(args.onRetry),
  });
  const deliveries = normalizeDeliveries(claimResponse);
  const results: WeClawDeliveryResult[] = [];
  let sent = 0;
  let failed = 0;

  args.deps.progress(`Claimed ${deliveries.length} deliveries.`);

  for (const delivery of deliveries) {
    args.deps.progress(`Sending delivery ${delivery.id} to ${delivery.targetUserId}...`);

    try {
      await args.deps.sendWeClawLocalMessage({
        baseUrl: args.weclawUrl,
        to: delivery.targetUserId,
        text: delivery.text,
        mediaUrl: delivery.mediaUrl,
      });
      await ackDelivery({
        deps: args.deps,
        baseUrl: args.baseUrl,
        token: args.token,
        deliveryId: delivery.id,
        status: 'sent',
        onRetry: args.onRetry,
      });
      sent += 1;
      results.push({
        id: delivery.id,
        targetUserId: delivery.targetUserId,
        status: 'sent',
      });
      args.deps.progress(`Acked delivery ${delivery.id} as sent.`);
    } catch (error) {
      const errorMessage = formatErrorMessage(error);

      await ackDelivery({
        deps: args.deps,
        baseUrl: args.baseUrl,
        token: args.token,
        deliveryId: delivery.id,
        status: 'failed',
        errorMessage,
        onRetry: args.onRetry,
      });
      failed += 1;
      results.push({
        id: delivery.id,
        targetUserId: delivery.targetUserId,
        status: 'failed',
        errorMessage,
      });
      args.deps.progress(`Acked delivery ${delivery.id} as failed: ${errorMessage}`);
    }
  }

  return {
    claimed: deliveries.length,
    sent,
    failed,
    deliveries: results,
  };
}

export async function weclawRelayCommand(
  args: WeClawRelayCommandArgs,
  dependencies: Partial<WeClawRelayDependencies> = {},
): Promise<WeClawRelayCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const weclawUrl = args.weclawUrl ?? DEFAULT_WECLAW_URL;
  const limit = args.limit ?? DEFAULT_WECLAW_RELAY_LIMIT;
  const intervalSeconds = args.intervalSeconds ?? DEFAULT_WECLAW_RELAY_INTERVAL_SECONDS;
  const relayId = args.relayId ?? deps.createRelayId();
  const summary: WeClawRelayCommandResult = {
    ok: true,
    once: args.once,
    relayId,
    weclawUrl,
    claimed: 0,
    sent: 0,
    failed: 0,
    cycles: 0,
    deliveries: [],
  };
  let failureStreak = 0;

  deps.progress('Checking local WeClaw...');
  await deps.checkWeClawHealth({
    baseUrl: weclawUrl,
  });
  deps.progress(`WeClaw is reachable: ${weclawUrl}`);

  while (!args.stopSignal?.aborted) {
    try {
      const cycle = await runRelayCycle({
        deps,
        baseUrl: args.baseUrl,
        token: args.token,
        weclawUrl,
        limit,
        relayId,
        onRetry: args.onRetry,
      });

      summary.cycles += 1;
      mergeCycleResult(summary, cycle);
      failureStreak = 0;
    } catch (error) {
      if (args.once) {
        throw error;
      }

      failureStreak += 1;
      deps.progress(`WeClaw relay cycle failed: ${formatErrorMessage(error)}`);
    }

    if (args.once) {
      break;
    }

    const sleepSeconds = failureStreak > 0
      ? Math.min(intervalSeconds * 2 ** failureStreak, 60)
      : intervalSeconds;

    deps.progress(`Sleeping ${sleepSeconds}s...`);
    await deps.sleep(sleepSeconds * 1000, args.stopSignal);
  }

  summary.ok = summary.failed === 0;

  return summary;
}
