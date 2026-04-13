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
