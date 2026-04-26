import { describe, expect, it, vi } from 'vitest';

describe('job output helpers', () => {
  it('extracts outputFileId from job result output', async () => {
    const { getJobOutputFileId } = await import('../../src/lib/job-output.js');

    expect(getJobOutputFileId({
      id: 'job_123',
      status: 'succeeded',
      result: {
        output: {
          outputFileId: 'file_123',
        },
      },
    })).toBe('file_123');
    expect(getJobOutputFileId({
      id: 'job_123',
      status: 'succeeded',
      result: {
        output: {},
      },
    })).toBeNull();
  });

  it('does not refresh again after the outputFileId timeout budget is consumed', async () => {
    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_123',
          status: 'succeeded',
          result: {},
        },
      },
      request_id: 'req_123',
    }));
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });

    const { waitForOutputFileId } = await import('../../src/lib/job-output.js');
    const result = await waitForOutputFileId({
      job: {
        id: 'job_123',
        status: 'succeeded',
        result: {},
      },
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      timeoutMs: 1,
      pollIntervalMs: 1,
    }, {
      apiRequest,
      sleep,
      now: () => now,
    });

    expect(result.outputFileId).toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1);
  });

  it('caps transient refresh retry sleeps to the remaining outputFileId timeout budget', async () => {
    const apiRequest = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        data: {
          job: {
            id: 'job_123',
            status: 'succeeded',
            result: {
              output: {
                outputFileId: 'file_123',
              },
            },
          },
        },
        request_id: 'req_123',
      });
    let now = 0;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });

    const { waitForOutputFileId } = await import('../../src/lib/job-output.js');
    const result = await waitForOutputFileId({
      job: {
        id: 'job_123',
        status: 'succeeded',
        result: {},
      },
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      timeoutMs: 10,
      pollIntervalMs: 10,
    }, {
      apiRequest,
      sleep,
      now: () => now,
    });

    expect(result.outputFileId).toBe('file_123');
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10);
  });
});
