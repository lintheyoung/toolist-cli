import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('apiRequest', () => {
  it('returns parsed JSON data for successful responses', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            workspace_id: 77,
          },
          request_id: 'req_123',
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    vi.stubGlobal('fetch', fetch);

    const { apiRequest } = await import('../../src/lib/http.js');
    const result = await apiRequest<{
      data: {
        workspace_id: number;
      };
      request_id: string;
    }>({
      baseUrl: 'https://api.example.com',
      method: 'GET',
      path: '/api/cli/me',
      token: 'tgc_cli_secret',
    });

    expect(result.data.workspace_id).toBe(77);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/cli/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tgc_cli_secret',
          accept: 'application/json',
        }),
        method: 'GET',
      }),
    );
  });

  it('throws structured CLI errors for API failures', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'RATE_LIMITED',
            message: 'Rate limit exceeded.',
            details: {
              limit: 60,
              remaining: 0,
              reset: 1_234_567_890,
            },
          },
          request_id: 'req_456',
        }),
        {
          status: 429,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    vi.stubGlobal('fetch', fetch);

    const { apiRequest } = await import('../../src/lib/http.js');

    await expect(
      apiRequest({
        baseUrl: 'https://api.example.com',
        method: 'GET',
        path: '/api/cli/me',
      }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Rate limit exceeded.',
      status: 429,
      details: {
        limit: 60,
        remaining: 0,
        reset: 1_234_567_890,
      },
    });
  });

  it('normalizes fetch transport failures into structured CLI errors', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    vi.stubGlobal('fetch', fetch);

    const { apiRequest } = await import('../../src/lib/http.js');

    await expect(
      apiRequest({
        baseUrl: 'https://api.example.com',
        method: 'GET',
        path: '/api/cli/me',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_UNEXPECTED_ERROR',
      message: 'An unexpected error occurred.',
      status: 0,
    });
  });

  it('adds request stage context to fetch transport failures', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    vi.stubGlobal('fetch', fetch);

    const { apiRequest } = await import('../../src/lib/http.js');

    await expect(
      apiRequest({
        baseUrl: 'https://api.example.com',
        method: 'POST',
        path: '/api/v1/jobs',
        stage: 'Create job request failed',
      }),
    ).rejects.toThrow('Create job request failed: fetch failed');
  });

  it('retries staged fetch transport failures before returning parsed JSON', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              job: {
                id: 'job_123',
                status: 'queued',
              },
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      );

    vi.stubGlobal('fetch', fetch);

    const { apiRequest } = await import('../../src/lib/http.js');
    const result = await apiRequest<{ data: { job: { id: string } } }>({
      baseUrl: 'https://api.example.com',
      method: 'POST',
      path: '/api/v1/jobs',
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [0, 0],
      },
    });

    expect(result.data.job.id).toBe('job_123');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('normalizes invalid JSON response bodies into structured CLI errors', async () => {
    const fetch = vi.fn(async () =>
      new Response('{"data":', {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
    );

    vi.stubGlobal('fetch', fetch);

    const { apiRequest } = await import('../../src/lib/http.js');

    await expect(
      apiRequest({
        baseUrl: 'https://api.example.com',
        method: 'GET',
        path: '/api/cli/me',
      }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_UNEXPECTED_ERROR',
      message: 'An unexpected error occurred.',
      status: 200,
    });
  });
});
