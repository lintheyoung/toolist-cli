import { apiRequest } from '../../lib/http.js';
import { extendedNetworkRetryOptions, type RetryHandler } from '../../lib/retry.js';

export interface WeClawBindCommandArgs {
  baseUrl: string;
  token: string;
  code: string;
  to: string;
  label?: string;
  configPath?: string;
  onRetry?: RetryHandler;
}

export interface WeClawBindCommandResult {
  ok: true;
  bindingId: string;
  targetUserId: string;
}

export interface WeClawBindDependencies {
  apiRequest: typeof apiRequest;
}

type WeClawBindResponse = {
  data?: unknown;
} & Record<string, unknown>;

function createDefaultDependencies(): WeClawBindDependencies {
  return {
    apiRequest,
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

function normalizeBindResponse(response: WeClawBindResponse): Omit<WeClawBindCommandResult, 'ok'> {
  const data = isRecord(response.data) ? response.data : response;
  const binding = isRecord(data.binding) ? data.binding : data;
  const bindingId = getString(binding, 'bindingId', 'binding_id');
  const targetUserId = getString(binding, 'targetUserId', 'target_user_id');

  if (!bindingId) {
    throw new Error('WeClaw binding completion response did not include bindingId.');
  }

  if (!targetUserId) {
    throw new Error('WeClaw binding completion response did not include targetUserId.');
  }

  return {
    bindingId,
    targetUserId,
  };
}

export async function weclawBindCommand(
  args: WeClawBindCommandArgs,
  dependencies: Partial<WeClawBindDependencies> = {},
): Promise<WeClawBindCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const body: {
    code: string;
    targetUserId: string;
    targetLabel?: string;
  } = {
    code: args.code,
    targetUserId: args.to,
  };

  if (args.label !== undefined) {
    body.targetLabel = args.label;
  }

  const response = await deps.apiRequest<WeClawBindResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'POST',
    path: '/api/v1/weclaw-bindings/complete',
    body,
    stage: 'WeClaw binding completion failed',
    retry: extendedNetworkRetryOptions(args.onRetry),
  });
  const normalized = normalizeBindResponse(response);

  return {
    ok: true,
    ...normalized,
  };
}
