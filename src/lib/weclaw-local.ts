import { formatErrorMessage } from './retry.js';

export const DEFAULT_WECLAW_URL = 'http://127.0.0.1:18011';

export class WeClawLocalError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'WeClawLocalError';
    this.status = status;
  }
}

function normalizeWeClawUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    throw new WeClawLocalError('WeClaw URL must not be empty.');
  }

  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';

    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new WeClawLocalError(`Invalid WeClaw URL: ${baseUrl}`);
  }
}

async function fetchLocal(args: {
  baseUrl: string;
  path: string;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  stage: string;
}): Promise<Response> {
  const fetcher = args.fetchImpl ?? fetch;

  try {
    return await fetcher(`${normalizeWeClawUrl(args.baseUrl)}${args.path}`, args.init);
  } catch (error) {
    throw new WeClawLocalError(`${args.stage} request failed: ${formatErrorMessage(error)}`);
  }
}

async function readResponseDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

export async function checkWeClawHealth(args: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; weclawUrl: string }> {
  const response = await fetchLocal({
    baseUrl: args.baseUrl,
    path: '/health',
    fetchImpl: args.fetchImpl,
    stage: 'WeClaw health check',
  });

  if (!response.ok) {
    const detail = await readResponseDetail(response);
    throw new WeClawLocalError(
      `WeClaw health check failed with status ${response.status}.${detail ? ` ${detail}` : ''}`,
      response.status,
    );
  }

  return {
    ok: true,
    weclawUrl: normalizeWeClawUrl(args.baseUrl),
  };
}

export async function sendWeClawLocalMessage(args: {
  baseUrl: string;
  to: string;
  text?: string;
  mediaUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true }> {
  const body: {
    to: string;
    text?: string;
    media_url?: string;
  } = {
    to: args.to,
  };

  if (args.text !== undefined) {
    body.text = args.text;
  }

  if (args.mediaUrl !== undefined) {
    body.media_url = args.mediaUrl;
  }

  const response = await fetchLocal({
    baseUrl: args.baseUrl,
    path: '/api/send',
    fetchImpl: args.fetchImpl,
    stage: 'WeClaw send',
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  });

  if (!response.ok) {
    const detail = await readResponseDetail(response);
    throw new WeClawLocalError(
      `WeClaw send failed with status ${response.status}.${detail ? ` ${detail}` : ''}`,
      response.status,
    );
  }

  return { ok: true };
}
