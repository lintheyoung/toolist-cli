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
});
