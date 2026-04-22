import { CliError } from './errors.js';
import { withRetry, withStageContext, type RetryOptions } from './retry.js';

type ApiErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  request_id?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function normalizeMethod(method?: string, body?: unknown): string {
  if (method) {
    return method;
  }

  return body === undefined ? 'GET' : 'POST';
}

function encodeBody(body: unknown): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  return JSON.stringify(body);
}

function unexpectedError(status = 0): CliError {
  return new CliError({
    code: 'INTERNAL_UNEXPECTED_ERROR',
    message: 'An unexpected error occurred.',
    status,
  });
}

function toCliError(status: number, payload: unknown): CliError {
  if (isObject(payload) && isObject(payload.error)) {
    const error = payload.error as ApiErrorEnvelope['error'];

    if (!error) {
      return unexpectedError(status);
    }

    return new CliError({
      code: typeof error.code === 'string' ? error.code : 'INTERNAL_UNEXPECTED_ERROR',
      message: typeof error.message === 'string' ? error.message : 'An unexpected error occurred.',
      status,
      details: error.details,
      requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
    });
  }

  return new CliError({
    code: 'INTERNAL_UNEXPECTED_ERROR',
    message: 'An unexpected error occurred.',
    status,
  });
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw unexpectedError(response.status);
  }
}

export async function apiRequest<T>(args: {
  baseUrl: string;
  token?: string;
  method?: string;
  path: string;
  body?: unknown;
  stage?: string;
  retry?: RetryOptions;
}): Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (args.token) {
    headers.authorization = `Bearer ${args.token}`;
  }

  const method = normalizeMethod(args.method, args.body);
  const body = encodeBody(args.body);

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  let response: Response;

  const fetchRequest = async () =>
    fetch(buildUrl(args.baseUrl, args.path), {
      method,
      headers,
      body,
    });

  try {
    if (args.stage && args.retry) {
      response = await withRetry({
        stage: args.stage,
        attempts: args.retry.attempts,
        delaysMs: args.retry.delaysMs,
        fn: fetchRequest,
      });
    } else if (args.stage) {
      response = await withStageContext(args.stage, fetchRequest);
    } else {
      response = await fetchRequest();
    }
  } catch (error) {
    if (args.stage) {
      throw error;
    }

    throw unexpectedError();
  }

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw toCliError(response.status, payload);
  }

  return payload as T;
}
