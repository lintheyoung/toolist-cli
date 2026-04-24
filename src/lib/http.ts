import { CliError } from './errors.js';
import {
  isRetryableTransportError,
  withRetry,
  withStageContext,
  type RetryOptions,
} from './retry.js';

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

class RetryableHttpResponseError extends CliError {
  constructor(error: CliError) {
    super({
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
      requestId: error.requestId,
    });
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function isRetryableApiRequestError(error: unknown): boolean {
  return error instanceof RetryableHttpResponseError || isRetryableTransportError(error);
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

function formatHttpStatus(status: number, statusTextValue = ''): string {
  const statusText = statusTextValue.trim();

  return statusText
    ? `HTTP ${status} ${statusText}`
    : `HTTP ${status}`;
}

async function retryableHttpResponseError(response: Response): Promise<RetryableHttpResponseError> {
  const status = response.status;
  const statusText = response.statusText;

  try {
    const text = await response.text();
    const payload = text.length > 0 ? JSON.parse(text) as unknown : undefined;

    return new RetryableHttpResponseError(toCliError(status, payload));
  } catch {
    // Retry classification should not depend on whether a transient 5xx body is parseable.
  }

  return new RetryableHttpResponseError(
    new CliError({
      code: 'INTERNAL_UNEXPECTED_ERROR',
      message: formatHttpStatus(status, statusText),
      status,
    }),
  );
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

  const fetchRequest = async () => {
    const result = await fetch(buildUrl(args.baseUrl, args.path), {
      method,
      headers,
      body,
    });

    if (args.stage && args.retry && isRetryableHttpStatus(result.status)) {
      // Retryable 5xx responses are discarded after this point, so it is safe to
      // consume the body here to preserve the final staged error message.
      throw await retryableHttpResponseError(result);
    }

    return result;
  };

  try {
    if (args.stage && args.retry) {
      response = await withRetry({
        stage: args.stage,
        attempts: args.retry.attempts,
        delaysMs: args.retry.delaysMs,
        onRetry: args.retry.onRetry,
        shouldRetry: isRetryableApiRequestError,
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
