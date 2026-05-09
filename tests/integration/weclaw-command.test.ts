import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('../../src/commands/weclaw/status.js');
  vi.doUnmock('../../src/commands/weclaw/bind.js');
  vi.doUnmock('../../src/commands/weclaw/relay.js');
});

describe('weclaw command', () => {
  it('shows weclaw help from the CLI', async () => {
    const { main } = await import('../../src/cli.js');

    let stdout = '';
    const exitCode = await main(['weclaw', '--help'], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: () => {},
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('toolist weclaw status');
    expect(stdout).toContain('toolist weclaw bind --code <code> --to <user_id@im.wechat>');
    expect(stdout).toContain('toolist weclaw relay');
  });

  it('sends a local WeClaw message through /api/send', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });

      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }) as typeof fetch;
    const { sendWeClawLocalMessage } = await import('../../src/lib/weclaw-local.js');

    const result = await sendWeClawLocalMessage({
      baseUrl: 'http://127.0.0.1:18011/',
      to: 'wx_target@im.wechat',
      text: 'Hello',
      fetchImpl,
    });

    expect(result).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:18011/api/send',
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          to: 'wx_target@im.wechat',
          text: 'Hello',
        }),
      },
    });
  });

  it('reports local WeClaw send 5xx with a clear error', async () => {
    const fetchImpl = vi.fn(async () => new Response('bridge failed', {
      status: 502,
      statusText: 'Bad Gateway',
    })) as typeof fetch;
    const { sendWeClawLocalMessage, WeClawLocalError } = await import('../../src/lib/weclaw-local.js');

    let caughtError: unknown;

    try {
      await sendWeClawLocalMessage({
        baseUrl: 'http://127.0.0.1:18011',
        to: 'wx_target@im.wechat',
        text: 'Hello',
        fetchImpl,
      });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(WeClawLocalError);
    expect(caughtError).toMatchObject({
      name: 'WeClawLocalError',
      status: 502,
      message: expect.stringContaining('WeClaw send failed with status 502'),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dispatches status through the CLI and keeps stdout JSON-only', async () => {
    const weclawStatusCommand = vi.fn(async () => ({
      ok: true,
      weclawUrl: 'http://127.0.0.1:18011',
    }));

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({ weclawRelayCommand: vi.fn() }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';
    const exitCode = await main([
      'weclaw',
      'status',
      '--weclaw-url',
      'http://127.0.0.1:18011',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(weclawStatusCommand).toHaveBeenCalledWith({
      weclawUrl: 'http://127.0.0.1:18011',
    });
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      weclawUrl: 'http://127.0.0.1:18011',
    });
  });

  it('rejects hosted API options for local WeClaw status', async () => {
    const weclawStatusCommand = vi.fn(async () => ({
      ok: true,
      weclawUrl: 'http://127.0.0.1:18011',
    }));

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({ weclawRelayCommand: vi.fn() }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';
    const exitCode = await main([
      'weclaw',
      'status',
      '--env',
      'test',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe('Unknown option: --env\n');
    expect(weclawStatusCommand).not.toHaveBeenCalled();
  });

  it('dispatches bind through the CLI with test hosted credentials', async () => {
    const weclawBindCommand = vi.fn(async () => ({
      ok: true,
      bindingId: 'wc_bind_123',
      targetUserId: 'wx_target@im.wechat',
    }));

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({ weclawRelayCommand: vi.fn() }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    const exitCode = await main([
      'weclaw',
      'bind',
      '--code',
      'wc_code_123',
      '--to',
      'wx_target@im.wechat',
      '--label',
      'Dede WeChat',
      '--env',
      'test',
      '--token',
      'tgc_test',
      '--config-path',
      '/tmp/toollist-missing-config.json',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: () => {},
    });

    expect(exitCode).toBe(0);
    expect(weclawBindCommand).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_test',
      code: 'wc_code_123',
      to: 'wx_target@im.wechat',
      label: 'Dede WeChat',
      configPath: '/tmp/toollist-missing-config.json',
    }));
    expect(JSON.parse(stdout)).toEqual(expect.objectContaining({
      ok: true,
      bindingId: 'wc_bind_123',
    }));
  });

  it('rejects bind when the pairing code is missing before calling the command', async () => {
    const weclawBindCommand = vi.fn();

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({ weclawRelayCommand: vi.fn() }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';
    const exitCode = await main([
      'weclaw',
      'bind',
      '--to',
      'wx_target@im.wechat',
      '--env',
      'test',
      '--token',
      'tgc_test',
      '--config-path',
      '/tmp/toollist-missing-config.json',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe('Missing required option: --code\n');
    expect(weclawBindCommand).not.toHaveBeenCalled();
  });

  it('rejects bind when the target user is missing before calling the command', async () => {
    const weclawBindCommand = vi.fn();

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({ weclawRelayCommand: vi.fn() }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';
    const exitCode = await main([
      'weclaw',
      'bind',
      '--code',
      'wc_code_123',
      '--env',
      'test',
      '--token',
      'tgc_test',
      '--config-path',
      '/tmp/toollist-missing-config.json',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe('Missing required option: --to\n');
    expect(weclawBindCommand).not.toHaveBeenCalled();
  });

  it('posts the binding completion body to Gateway', async () => {
    const apiRequest = vi.fn(async () => ({
      data: {
        binding: {
          bindingId: 'wc_bind_123',
          targetUserId: 'wx_target@im.wechat',
        },
      },
    }));
    const { weclawBindCommand } = await import('../../src/commands/weclaw/bind.js');

    const result = await weclawBindCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'toolist-token',
      code: 'wc_code_123',
      to: 'wx_target@im.wechat',
      label: 'Dede WeChat',
    }, {
      apiRequest,
    });

    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://test.tooli.st',
      token: 'toolist-token',
      method: 'POST',
      path: '/api/v1/weclaw-bindings/complete',
      body: {
        code: 'wc_code_123',
        targetUserId: 'wx_target@im.wechat',
        targetLabel: 'Dede WeChat',
      },
      stage: 'WeClaw binding completion failed',
    }));
    expect(result).toEqual({
      ok: true,
      bindingId: 'wc_bind_123',
      targetUserId: 'wx_target@im.wechat',
    });
  });

  it('claims one delivery, sends locally, and acks sent', async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const apiRequest = vi.fn(async <T,>(args: { path: string; body?: unknown }) => {
      requests.push({ path: args.path, body: args.body });

      if (args.path === '/api/v1/weclaw-deliveries/claim') {
        return {
          data: {
            deliveries: [{
              id: 'wc_delivery_123',
              to: 'wx_target@im.wechat',
              text: 'Toolist job failed',
              mediaUrl: null,
            }],
          },
        } as T;
      }

      return { data: { ok: true } } as T;
    });
    const checkWeClawHealth = vi.fn(async () => ({
      ok: true,
      weclawUrl: 'http://127.0.0.1:18011',
    }));
    const sendWeClawLocalMessage = vi.fn(async () => ({ ok: true }));
    const progress = vi.fn();
    const { weclawRelayCommand } = await import('../../src/commands/weclaw/relay.js');

    const result = await weclawRelayCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'toolist-token',
      weclawUrl: 'http://127.0.0.1:18011',
      once: true,
      limit: 10,
      intervalSeconds: 10,
      relayId: 'test-relay',
    }, {
      apiRequest,
      checkWeClawHealth,
      sendWeClawLocalMessage,
      progress,
    });

    expect(checkWeClawHealth).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://127.0.0.1:18011',
    }));
    expect(requests).toContainEqual({
      path: '/api/v1/weclaw-deliveries/claim',
      body: {
        limit: 10,
        relayId: 'test-relay',
      },
    });
    expect(sendWeClawLocalMessage).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'http://127.0.0.1:18011',
      to: 'wx_target@im.wechat',
      text: 'Toolist job failed',
    }));
    expect(requests).toContainEqual({
      path: '/api/v1/weclaw-deliveries/wc_delivery_123/ack',
      body: {
        status: 'sent',
      },
    });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      once: true,
      claimed: 1,
      sent: 1,
      failed: 0,
    }));
  });

  it('handles an empty relay claim without sending or acking', async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const apiRequest = vi.fn(async <T,>(args: { path: string; body?: unknown }) => {
      requests.push({ path: args.path, body: args.body });

      return {
        data: {
          deliveries: [],
        },
      } as T;
    });
    const sendWeClawLocalMessage = vi.fn(async () => ({ ok: true }));
    const { weclawRelayCommand } = await import('../../src/commands/weclaw/relay.js');

    const result = await weclawRelayCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'toolist-token',
      weclawUrl: 'http://127.0.0.1:18011',
      once: true,
      limit: 10,
      intervalSeconds: 10,
      relayId: 'test-relay',
    }, {
      apiRequest,
      checkWeClawHealth: vi.fn(async () => ({ ok: true })),
      sendWeClawLocalMessage,
      progress: vi.fn(),
    });

    expect(requests).toEqual([{
      path: '/api/v1/weclaw-deliveries/claim',
      body: {
        limit: 10,
        relayId: 'test-relay',
      },
    }]);
    expect(sendWeClawLocalMessage).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      claimed: 0,
      sent: 0,
      failed: 0,
      cycles: 1,
      deliveries: [],
    }));
  });

  it('processes multiple relay deliveries in one cycle', async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const apiRequest = vi.fn(async <T,>(args: { path: string; body?: unknown }) => {
      requests.push({ path: args.path, body: args.body });

      if (args.path === '/api/v1/weclaw-deliveries/claim') {
        return {
          data: {
            deliveries: [
              {
                id: 'wc_delivery_1',
                to: 'wx_target_1@im.wechat',
                text: 'First',
              },
              {
                id: 'wc_delivery_2',
                to: 'wx_target_2@im.wechat',
                text: 'Second',
              },
            ],
          },
        } as T;
      }

      return { data: { ok: true } } as T;
    });
    const sendWeClawLocalMessage = vi.fn(async () => ({ ok: true }));
    const { weclawRelayCommand } = await import('../../src/commands/weclaw/relay.js');

    const result = await weclawRelayCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'toolist-token',
      weclawUrl: 'http://127.0.0.1:18011',
      once: true,
      limit: 10,
      intervalSeconds: 10,
      relayId: 'test-relay',
    }, {
      apiRequest,
      checkWeClawHealth: vi.fn(async () => ({ ok: true })),
      sendWeClawLocalMessage,
      progress: vi.fn(),
    });

    expect(sendWeClawLocalMessage).toHaveBeenCalledTimes(2);
    expect(sendWeClawLocalMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: 'wx_target_1@im.wechat',
      text: 'First',
    }));
    expect(sendWeClawLocalMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      to: 'wx_target_2@im.wechat',
      text: 'Second',
    }));
    expect(requests).toContainEqual({
      path: '/api/v1/weclaw-deliveries/wc_delivery_1/ack',
      body: {
        status: 'sent',
      },
    });
    expect(requests).toContainEqual({
      path: '/api/v1/weclaw-deliveries/wc_delivery_2/ack',
      body: {
        status: 'sent',
      },
    });
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      claimed: 2,
      sent: 2,
      failed: 0,
      cycles: 1,
    }));
    expect(result.deliveries.map((delivery) => delivery.id)).toEqual([
      'wc_delivery_1',
      'wc_delivery_2',
    ]);
  });

  it('acks failed and reports the error when local WeClaw send fails', async () => {
    const requests: Array<{ path: string; body?: unknown }> = [];
    const apiRequest = vi.fn(async <T,>(args: { path: string; body?: unknown }) => {
      requests.push({ path: args.path, body: args.body });

      if (args.path === '/api/v1/weclaw-deliveries/claim') {
        return {
          data: {
            deliveries: [{
              id: 'wc_delivery_500',
              to: 'wx_target@im.wechat',
              text: 'Toolist job failed',
            }],
          },
        } as T;
      }

      return { data: { ok: true } } as T;
    });
    const sendWeClawLocalMessage = vi.fn(async () => {
      throw new Error('WeClaw send failed with status 500. bridge failed');
    });
    const { weclawRelayCommand } = await import('../../src/commands/weclaw/relay.js');

    const result = await weclawRelayCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'toolist-token',
      weclawUrl: 'http://127.0.0.1:18011',
      once: true,
      limit: 10,
      intervalSeconds: 10,
      relayId: 'test-relay',
    }, {
      apiRequest,
      checkWeClawHealth: vi.fn(async () => ({ ok: true })),
      sendWeClawLocalMessage,
      progress: vi.fn(),
    });

    expect(requests).toContainEqual({
      path: '/api/v1/weclaw-deliveries/wc_delivery_500/ack',
      body: {
        status: 'failed',
        errorMessage: 'WeClaw send failed with status 500. bridge failed',
      },
    });
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      claimed: 1,
      sent: 0,
      failed: 1,
    }));
    expect(result.deliveries[0]).toEqual(expect.objectContaining({
      id: 'wc_delivery_500',
      status: 'failed',
      errorMessage: 'WeClaw send failed with status 500. bridge failed',
    }));
  });

  it('stops continuous relay when sleep aborts the stop signal', async () => {
    const controller = new AbortController();
    const apiRequest = vi.fn(async <T,>() => ({
      data: {
        deliveries: [],
      },
    }) as T);
    const sleep = vi.fn(async () => {
      controller.abort();
    });
    const { weclawRelayCommand } = await import('../../src/commands/weclaw/relay.js');

    const result = await weclawRelayCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'toolist-token',
      weclawUrl: 'http://127.0.0.1:18011',
      once: false,
      limit: 10,
      intervalSeconds: 1,
      relayId: 'test-relay',
      stopSignal: controller.signal,
    }, {
      apiRequest,
      checkWeClawHealth: vi.fn(async () => ({ ok: true })),
      sendWeClawLocalMessage: vi.fn(async () => ({ ok: true })),
      progress: vi.fn(),
      sleep,
    });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000, controller.signal);
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      once: false,
      claimed: 0,
      sent: 0,
      failed: 0,
      cycles: 1,
    }));
  });

  it('marks continuous relay unhealthy when a claim cycle fails before abort', async () => {
    const controller = new AbortController();
    const apiRequest = vi.fn(async () => {
      throw new Error('claim unavailable');
    });
    const sleep = vi.fn(async () => {
      controller.abort();
    });
    const { weclawRelayCommand } = await import('../../src/commands/weclaw/relay.js');

    const result = await weclawRelayCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'toolist-token',
      weclawUrl: 'http://127.0.0.1:18011',
      once: false,
      limit: 10,
      intervalSeconds: 1,
      relayId: 'test-relay',
      stopSignal: controller.signal,
    }, {
      apiRequest,
      checkWeClawHealth: vi.fn(async () => ({ ok: true })),
      sendWeClawLocalMessage: vi.fn(async () => ({ ok: true })),
      progress: vi.fn(),
      sleep,
    });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000, controller.signal);
    expect(result).toEqual(expect.objectContaining({
      ok: false,
      once: false,
      claimed: 0,
      sent: 0,
      failed: 0,
      cycles: 0,
      cycleFailures: 1,
    }));
  });

  it('wires and removes process signal handlers for continuous relay CLI runs', async () => {
    const weclawRelayCommand = vi.fn(async () => ({
      ok: true,
      once: false,
      relayId: 'test-relay',
      weclawUrl: 'http://127.0.0.1:18011',
      claimed: 0,
      sent: 0,
      failed: 0,
      cycleFailures: 0,
      cycles: 1,
      deliveries: [],
    }));
    const onceSpy = vi.spyOn(process, 'once');
    const removeListenerSpy = vi.spyOn(process, 'removeListener');

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({
      DEFAULT_WECLAW_RELAY_INTERVAL_SECONDS: 10,
      DEFAULT_WECLAW_RELAY_LIMIT: 10,
      weclawRelayCommand,
    }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';
    const exitCode = await main([
      'weclaw',
      'relay',
      '--env',
      'test',
      '--token',
      'tgc_test',
      '--config-path',
      '/tmp/toollist-missing-config.json',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    const relayArgs = weclawRelayCommand.mock.calls[0]?.[0];
    const sigintHandler = onceSpy.mock.calls.find(([event]) => event === 'SIGINT')?.[1];
    const sigtermHandler = onceSpy.mock.calls.find(([event]) => event === 'SIGTERM')?.[1];

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual(expect.objectContaining({
      ok: true,
      once: false,
    }));
    expect(relayArgs).toEqual(expect.objectContaining({
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_test',
      once: false,
    }));
    expect(relayArgs?.stopSignal).toBeInstanceOf(AbortSignal);
    expect(sigintHandler).toEqual(expect.any(Function));
    expect(sigtermHandler).toEqual(expect.any(Function));
    expect(removeListenerSpy).toHaveBeenCalledWith('SIGINT', sigintHandler);
    expect(removeListenerSpy).toHaveBeenCalledWith('SIGTERM', sigtermHandler);
  });

  it('parses relay --limit and --interval when values are separated by spaces', async () => {
    const weclawRelayCommand = vi.fn(async () => ({
      ok: true,
      once: true,
      relayId: 'relay-space',
      weclawUrl: 'http://127.0.0.1:18011',
      claimed: 0,
      sent: 0,
      failed: 0,
      cycleFailures: 0,
      cycles: 1,
      deliveries: [],
    }));

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({
      DEFAULT_WECLAW_RELAY_INTERVAL_SECONDS: 10,
      DEFAULT_WECLAW_RELAY_LIMIT: 10,
      weclawRelayCommand,
    }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';
    const exitCode = await main([
      'weclaw',
      'relay',
      '--once',
      '--limit',
      '5',
      '--interval',
      '7',
      '--relay-id',
      'relay-space',
      '--env',
      'test',
      '--token',
      'tgc_test',
      '--config-path',
      '/tmp/toollist-missing-config.json',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ ok: true, once: true }));
    expect(weclawRelayCommand.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      intervalSeconds: 7,
      limit: 5,
      relayId: 'relay-space',
    }));
  });

  it('parses relay --limit and --interval when values use equals syntax', async () => {
    const weclawRelayCommand = vi.fn(async () => ({
      ok: true,
      once: true,
      relayId: 'relay-equals',
      weclawUrl: 'http://127.0.0.1:18011',
      claimed: 0,
      sent: 0,
      failed: 0,
      cycleFailures: 0,
      cycles: 1,
      deliveries: [],
    }));

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({
      DEFAULT_WECLAW_RELAY_INTERVAL_SECONDS: 10,
      DEFAULT_WECLAW_RELAY_LIMIT: 10,
      weclawRelayCommand,
    }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';
    const exitCode = await main([
      'weclaw',
      'relay',
      '--once',
      '--limit=6',
      '--interval=8',
      '--relay-id',
      'relay-equals',
      '--env',
      'test',
      '--token',
      'tgc_test',
      '--config-path',
      '/tmp/toollist-missing-config.json',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ ok: true, once: true }));
    expect(weclawRelayCommand.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      intervalSeconds: 8,
      limit: 6,
      relayId: 'relay-equals',
    }));
  });

  it('removes process signal handlers when continuous relay CLI runs fail', async () => {
    const weclawRelayCommand = vi.fn(async () => {
      throw new Error('relay unavailable');
    });
    const onceSpy = vi.spyOn(process, 'once');
    const removeListenerSpy = vi.spyOn(process, 'removeListener');

    vi.doMock('../../src/commands/weclaw/status.js', () => ({ weclawStatusCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/bind.js', () => ({ weclawBindCommand: vi.fn() }));
    vi.doMock('../../src/commands/weclaw/relay.js', () => ({
      DEFAULT_WECLAW_RELAY_INTERVAL_SECONDS: 10,
      DEFAULT_WECLAW_RELAY_LIMIT: 10,
      weclawRelayCommand,
    }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';
    const exitCode = await main([
      'weclaw',
      'relay',
      '--env',
      'test',
      '--token',
      'tgc_test',
      '--config-path',
      '/tmp/toollist-missing-config.json',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    const sigintHandler = onceSpy.mock.calls.find(([event]) => event === 'SIGINT')?.[1];
    const sigtermHandler = onceSpy.mock.calls.find(([event]) => event === 'SIGTERM')?.[1];

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe('relay unavailable\n');
    expect(weclawRelayCommand).toHaveBeenCalledWith(expect.objectContaining({
      once: false,
      stopSignal: expect.any(AbortSignal),
    }), expect.any(Object));
    expect(sigintHandler).toEqual(expect.any(Function));
    expect(sigtermHandler).toEqual(expect.any(Function));
    expect(removeListenerSpy).toHaveBeenCalledWith('SIGINT', sigintHandler);
    expect(removeListenerSpy).toHaveBeenCalledWith('SIGTERM', sigtermHandler);
  });
});
