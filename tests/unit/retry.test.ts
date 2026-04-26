import { describe, expect, it, vi } from 'vitest';

describe('retry helpers', () => {
  it('formats Error and non-Error values', async () => {
    const { formatErrorMessage } = await import('../../src/lib/retry.js');

    expect(formatErrorMessage(new Error('fetch failed'))).toBe('fetch failed');
    expect(formatErrorMessage('plain failure')).toBe('plain failure');
    expect(formatErrorMessage(404)).toBe('404');
  });

  it('adds stage context to failures', async () => {
    const { withStageContext } = await import('../../src/lib/retry.js');

    await expect(
      withStageContext('Output download failed', async () => {
        throw new TypeError('fetch failed');
      }),
    ).rejects.toThrow('Output download failed: fetch failed');
  });

  it('does not duplicate existing stage context', async () => {
    const { withStageContext } = await import('../../src/lib/retry.js');

    await expect(
      withStageContext('Job polling failed', async () => {
        throw new Error('Job polling failed: fetch failed');
      }),
    ).rejects.toThrow('Job polling failed: fetch failed');
  });

  it('clamps attempts to one when retry attempts are invalid', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const sleep = vi.fn(async () => undefined);

    const { withRetry } = await import('../../src/lib/retry.js');

    await expect(
      withRetry({
        stage: 'Create job request failed',
        attempts: 0,
        delaysMs: [1000],
        fn,
        sleep,
      }),
    ).rejects.toThrow('Create job request failed: fetch failed');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('falls back to the last delay when there are fewer delays than retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('ok');
    const sleep = vi.fn(async () => undefined);

    const { withRetry } = await import('../../src/lib/retry.js');
    const result = await withRetry({
      stage: 'Job polling failed',
      attempts: 3,
      delaysMs: [250],
      fn,
      sleep,
    });

    expect(result).toBe('ok');
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 250);
  });

  it('keeps stage context when shouldRetry rejects a retry', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('validation failed');
    });

    const { withRetry } = await import('../../src/lib/retry.js');

    await expect(
      withRetry({
        stage: 'Create job request failed',
        attempts: 3,
        delaysMs: [1000, 3000],
        fn,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('Create job request failed: validation failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reports retry attempts before sleeping', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('ok');
    const sleep = vi.fn(async () => undefined);
    const onRetry = vi.fn();

    const { withRetry } = await import('../../src/lib/retry.js');
    const result = await withRetry({
      stage: 'Upload request failed',
      attempts: 4,
      delaysMs: [1000, 3000, 7000],
      fn,
      sleep,
      onRetry,
    });

    expect(result).toBe('ok');
    expect(onRetry).toHaveBeenCalledWith({
      stage: 'Upload request failed',
      error: expect.any(TypeError),
      retryAttempt: 1,
      maxAttempts: 4,
      delayMs: 1000,
    });
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('formats retry progress for stderr without touching stdout', async () => {
    const { createStderrRetryReporter } = await import('../../src/lib/retry.js');
    let stderr = '';
    const reporter = createStderrRetryReporter((chunk) => {
      stderr += chunk;
    });

    reporter({
      stage: 'Create upload request failed',
      error: new TypeError('fetch failed'),
      retryAttempt: 1,
      maxAttempts: 4,
      delayMs: 1000,
    });

    expect(stderr).toBe(
      'Create upload request failed: fetch failed\n' +
      'Retrying create upload request (1/4) in 1000ms...\n',
    );
  });

  it('keeps retry handlers directly readable without adding them to spreads', async () => {
    const onRetry = vi.fn();
    const { withRetryHandler } = await import('../../src/lib/retry.js');

    const args = withRetryHandler({ value: 1 }, onRetry);

    expect(args.onRetry).toBe(onRetry);
    expect({ ...args }).toEqual({ value: 1 });
  });

  it('classifies common transport failures as retryable', async () => {
    const { isRetryableTransportError } = await import('../../src/lib/retry.js');
    const reset = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const undici = Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' });
    const fetchFailed = new TypeError('fetch failed');

    expect(isRetryableTransportError(fetchFailed)).toBe(true);
    expect(isRetryableTransportError(reset)).toBe(true);
    expect(isRetryableTransportError(undici)).toBe(true);
    expect(isRetryableTransportError(new Error('validation failed'))).toBe(false);
  });
});
