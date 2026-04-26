import { CliError, isCliError } from './errors.js';
import {
  extendedNetworkRetryOptions,
  isRetryableTransportError,
  withRetry,
  type RetryHandler,
} from './retry.js';

function buildFileDownloadUrl(baseUrl: string, fileId: string): string {
  return new URL(`/api/v1/files/${encodeURIComponent(fileId)}/download`, baseUrl).toString();
}

function formatHttpStatus(status: number, statusTextValue = ''): string {
  const statusText = statusTextValue.trim();

  return statusText
    ? `HTTP ${status} ${statusText}`
    : `HTTP ${status}`;
}

function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function isRetryableDownloadError(error: unknown): boolean {
  return (
    isRetryableTransportError(error) ||
    (isCliError(error) && isRetryableHttpStatus(error.status))
  );
}

export async function fetchFileDownloadResponse(
  args: {
    baseUrl: string;
    token: string;
    fileId: string;
    onRetry?: RetryHandler;
  },
  fetchFn: typeof fetch,
): Promise<Response> {
  const retry = extendedNetworkRetryOptions(args.onRetry);

  return withRetry({
    stage: 'Output download failed',
    attempts: retry.attempts,
    delaysMs: retry.delaysMs,
    onRetry: retry.onRetry,
    shouldRetry: isRetryableDownloadError,
    fn: async () => {
      const response = await fetchFn(buildFileDownloadUrl(args.baseUrl, args.fileId), {
        headers: {
          authorization: `Bearer ${args.token}`,
        },
      });

      if (isRetryableHttpStatus(response.status)) {
        throw new CliError({
          code: 'HTTP_RETRYABLE_STATUS',
          message: formatHttpStatus(response.status, response.statusText),
          status: response.status,
        });
      }

      return response;
    },
  });
}
