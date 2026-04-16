import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('login callback flow', () => {
  it('starts a loopback callback server and resolves with code and state', async () => {
    const { startCallbackServer } = await import('../../src/lib/callback-server.js');

    const server = await startCallbackServer('state_123');
    const callbackUrl = new URL(server.redirectUri);
    callbackUrl.searchParams.set('code', 'cli_code_123');
    callbackUrl.searchParams.set('state', 'state_123');

    const resultPromise = server.waitForCallback();
    const response = await fetch(callbackUrl);
    const result = await resultPromise;

    expect(response.status).toBe(200);
    expect(result.code).toBe('cli_code_123');
    expect(result.state).toBe('state_123');

    await server.close();
  });

  it('can continue waiting after an invalid-state callback and resolve on the next valid callback', async () => {
    const { startCallbackServer } = await import('../../src/lib/callback-server.js');

    const server = await startCallbackServer('expected_state');
    const invalidUrl = new URL(server.redirectUri);
    invalidUrl.searchParams.set('code', 'bad_code');
    invalidUrl.searchParams.set('state', 'wrong_state');

    const validUrl = new URL(server.redirectUri);
    validUrl.searchParams.set('code', 'cli_code_456');
    validUrl.searchParams.set('state', 'expected_state');

    const firstWait = server.waitForCallback();
    const firstRejection = expect(firstWait).rejects.toThrow('Invalid callback state.');
    const invalidResponse = await fetch(invalidUrl);
    await firstRejection;
    expect(invalidResponse.status).toBe(400);

    const secondWait = server.waitForCallback();
    const validResponse = await fetch(validUrl);
    const result = await secondWait;

    expect(validResponse.status).toBe(200);
    expect(result).toEqual({
      code: 'cli_code_456',
      state: 'expected_state',
    });

    await server.close();
  });

  it('rejects a callback with the wrong state nonce', async () => {
    const { startCallbackServer } = await import('../../src/lib/callback-server.js');

    const server = await startCallbackServer('expected_state');
    const callbackUrl = new URL(server.redirectUri);
    callbackUrl.searchParams.set('code', 'cli_code_123');
    callbackUrl.searchParams.set('state', 'wrong_state');

    const resultPromise = server.waitForCallback();
    const rejection = expect(resultPromise).rejects.toThrow('Invalid callback state.');
    const response = await fetch(callbackUrl);

    await rejection;
    expect(response.status).toBe(400);

    await server.close();
  });

  it('rejects a pending callback when the server is closed', async () => {
    const { startCallbackServer } = await import('../../src/lib/callback-server.js');

    const server = await startCallbackServer('state_123');
    const resultPromise = server.waitForCallback();
    const rejection = expect(resultPromise).rejects.toThrow('Callback server closed before receiving a callback.');

    await server.close();

    await rejection;
  });

  it('opens the browser with the platform launcher', async () => {
    const spawn = vi.fn(() => {
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      const child = {
        once: (event: string, handler: (...args: unknown[]) => void) => {
          const existing = listeners.get(event) ?? [];
          listeners.set(event, [...existing, handler]);
          return child;
        },
        unref: vi.fn(),
      };
      queueMicrotask(() => {
        for (const handler of listeners.get('spawn') ?? []) {
          handler();
        }
      });
      return child;
    });
    vi.doMock('node:child_process', () => ({
      spawn,
    }));
    vi.doMock('node:os', () => ({
      platform: () => 'darwin',
    }));

    const { openBrowser } = await import('../../src/lib/browser.js');

    await openBrowser('https://example.com/login');

    expect(spawn).toHaveBeenCalledWith(
      'open',
      ['https://example.com/login'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    );
  });

  it('uses a quoted Windows start command for browser URLs', async () => {
    const spawn = vi.fn(() => {
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      const child = {
        once: (event: string, handler: (...args: unknown[]) => void) => {
          const existing = listeners.get(event) ?? [];
          listeners.set(event, [...existing, handler]);
          return child;
        },
        unref: vi.fn(),
      };
      queueMicrotask(() => {
        for (const handler of listeners.get('spawn') ?? []) {
          handler();
        }
      });
      return child;
    });
    vi.doMock('node:child_process', () => ({
      spawn,
    }));
    vi.doMock('node:os', () => ({
      platform: () => 'win32',
    }));

    const { openBrowser } = await import('../../src/lib/browser.js');

    await openBrowser('https://example.com/login?next=/dashboard');

    expect(spawn).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '""', '"https://example.com/login?next=/dashboard"'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      }),
    );
  });

  it('rejects when the browser launcher fails before callback wait begins', async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const spawn = vi.fn(() => {
      const child = {
        once: (event: string, handler: (...args: unknown[]) => void) => {
          const existing = listeners.get(event) ?? [];
          listeners.set(event, [...existing, handler]);
          return child;
        },
        unref: vi.fn(),
      };
      queueMicrotask(() => {
        for (const handler of listeners.get('error') ?? []) {
          handler(new Error('open failed'));
        }
      });
      return child;
    });
    vi.doMock('node:child_process', () => ({
      spawn,
    }));
    vi.doMock('node:os', () => ({
      platform: () => 'darwin',
    }));

    const { openBrowser } = await import('../../src/lib/browser.js');

    await expect(openBrowser('https://example.com/login')).rejects.toThrow(
      'open failed'
    );
  });
});
