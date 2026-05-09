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

    await expect(sendWeClawLocalMessage({
      baseUrl: 'http://127.0.0.1:18011',
      to: 'wx_target@im.wechat',
      text: 'Hello',
      fetchImpl,
    })).rejects.toMatchObject({
      name: 'WeClawLocalError',
      status: 502,
      message: expect.stringContaining('WeClaw send failed with status 502'),
    });
    await expect(sendWeClawLocalMessage({
      baseUrl: 'http://127.0.0.1:18011',
      to: 'wx_target@im.wechat',
      text: 'Hello',
      fetchImpl,
    })).rejects.toBeInstanceOf(WeClawLocalError);
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
});
