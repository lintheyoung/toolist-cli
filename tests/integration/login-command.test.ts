import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/login.js');
});

describe('login command', () => {
  it('dispatches login through the CLI and forwards the selected environment', async () => {
    const loginCommand = vi.fn(async () => ({
      baseUrl: 'https://api.example.com',
      workspace: {
        id: 77,
        name: 'Acme',
      },
      user: {
        id: 11,
        email: 'agent@example.com',
      },
      expiresAt: '2026-04-13T00:00:00.000Z',
    }));

    vi.doMock('../../src/commands/login.js', () => ({
      loginCommand,
    }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';

    const exitCode = await main(['login', '--env', 'test', '--json'], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(0);
    expect(loginCommand).toHaveBeenCalledWith({
      baseUrl: 'https://test.tooli.st',
      environment: 'test',
      clientName: undefined,
      configPath: undefined,
    }, {
      announceBrowserLaunch: expect.any(Function),
    });
    expect(JSON.parse(stdout)).toEqual({
      baseUrl: 'https://api.example.com',
      workspace: {
        id: 77,
        name: 'Acme',
      },
      user: {
        id: 11,
        email: 'agent@example.com',
      },
      expiresAt: '2026-04-13T00:00:00.000Z',
    });
    expect(stderr).toBe('');
  });

  it('opens the browser, exchanges the auth code, and stores config', async () => {
    const { loginCommand } = await import('../../src/commands/login.js');

    const openBrowser = vi.fn(async () => undefined);
    const announceBrowserLaunch = vi.fn();
    const saveConfig = vi.fn(async () => undefined);
    const startCallbackServer = vi.fn(async (expectedState: string) => ({
      redirectUri: 'http://localhost:45231/callback',
      waitForCallback: async () => ({
        code: 'code_123',
        state: expectedState,
      }),
      close: async () => undefined,
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        access_token: 'tgc_cli_secret',
        token_type: 'Bearer',
        expires_at: '2026-04-13T00:00:00.000Z',
        workspace_id: 77,
        workspace_name: 'Acme',
        user_id: 11,
        user_email: 'agent@example.com',
        base_url: 'https://api.example.com',
        scopes: ['workspace:read', 'tools:read'],
      },
      request_id: 'req_login_123',
    }));

    const result = await loginCommand(
      {
        baseUrl: 'https://api.example.com',
        clientName: 'Local CLI',
        configPath: '/tmp/toollist-config.json',
      },
      {
        openBrowser,
        announceBrowserLaunch,
        saveConfig,
        startCallbackServer,
        apiRequest,
        randomUUID: () => 'state_123',
        createCodeVerifier: () => 'verifier_123',
        createCodeChallenge: () => 'challenge_123',
      },
    );

    expect(startCallbackServer).toHaveBeenCalledWith('state_123');
    expect(announceBrowserLaunch).toHaveBeenCalledTimes(1);
    expect(openBrowser).toHaveBeenCalledTimes(1);

    const openedUrl = new URL(openBrowser.mock.calls[0]![0]);
    expect(openedUrl.origin + openedUrl.pathname).toBe('https://api.example.com/api/cli/auth/start');
    expect(openedUrl.searchParams.get('redirect_uri')).toBe('http://localhost:45231/callback');
    expect(openedUrl.searchParams.get('state')).toBe('state_123');
    expect(openedUrl.searchParams.get('code_challenge')).toBe('challenge_123');
    expect(openedUrl.searchParams.get('client_name')).toBe('Local CLI');
    expect(openedUrl.searchParams.get('base_url')).toBe('https://api.example.com');

    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      method: 'POST',
      path: '/api/cli/auth/exchange',
      body: {
        code: 'code_123',
        state: 'state_123',
        redirect_uri: 'http://localhost:45231/callback',
        code_verifier: 'verifier_123',
      },
    });
    expect(saveConfig).toHaveBeenCalledWith(
      {
        activeEnvironment: 'prod',
        profiles: {
          prod: {
            environment: 'prod',
            baseUrl: 'https://api.example.com',
            accessToken: 'tgc_cli_secret',
          },
        },
      },
      '/tmp/toollist-config.json',
    );
    expect(result).toEqual({
      baseUrl: 'https://api.example.com',
      workspace: {
        id: 77,
        name: 'Acme',
      },
      user: {
        id: 11,
        email: 'agent@example.com',
      },
      expiresAt: '2026-04-13T00:00:00.000Z',
    });
  });

  it('closes the callback server when browser launch fails', async () => {
    const { loginCommand } = await import('../../src/commands/login.js');

    const close = vi.fn(async () => undefined);
    const startCallbackServer = vi.fn(async () => ({
      redirectUri: 'http://localhost:45231/callback',
      waitForCallback: async () => ({
        code: 'code_123',
        state: 'state_123',
      }),
      close,
    }));

    await expect(
      loginCommand(
        {
          baseUrl: 'https://api.example.com',
        },
        {
          openBrowser: vi.fn(async () => {
            throw new Error('browser unavailable');
          }),
          saveConfig: vi.fn(async () => undefined),
          startCallbackServer,
          apiRequest: vi.fn(),
          randomUUID: () => 'state_123',
          createCodeVerifier: () => 'verifier_123',
          createCodeChallenge: () => 'challenge_123',
        },
      ),
    ).rejects.toThrow('browser unavailable');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting for a later callback when the first exchanged auth code is invalid', async () => {
    const { loginCommand } = await import('../../src/commands/login.js');

    const openBrowser = vi.fn(async () => undefined);
    const saveConfig = vi.fn(async () => undefined);
    const waitForCallback = vi
      .fn()
      .mockResolvedValueOnce({
        code: 'bad_code',
        state: 'state_123',
      })
      .mockResolvedValueOnce({
        code: 'good_code',
        state: 'state_123',
      });
    const close = vi.fn(async () => undefined);
    const startCallbackServer = vi.fn(async () => ({
      redirectUri: 'http://localhost:45231/callback',
      waitForCallback,
      close,
    }));
    const apiRequest = vi
      .fn()
      .mockRejectedValueOnce(new Error('A valid CLI auth code is required.'))
      .mockResolvedValueOnce({
        data: {
          access_token: 'tgc_cli_secret',
          token_type: 'Bearer',
          expires_at: '2026-04-13T00:00:00.000Z',
          workspace_id: 77,
          workspace_name: 'Acme',
          user_id: 11,
          user_email: 'agent@example.com',
          base_url: 'https://api.example.com',
          scopes: ['workspace:read', 'tools:read'],
        },
        request_id: 'req_login_456',
      });

    const result = await loginCommand(
      {
        baseUrl: 'https://api.example.com',
      },
      {
        openBrowser,
        saveConfig,
        startCallbackServer,
        apiRequest,
        randomUUID: () => 'state_123',
        createCodeVerifier: () => 'verifier_123',
        createCodeChallenge: () => 'challenge_123',
      },
    );

    expect(waitForCallback).toHaveBeenCalledTimes(2);
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      baseUrl: 'https://api.example.com',
      workspace: {
        id: 77,
        name: 'Acme',
      },
      user: {
        id: 11,
        email: 'agent@example.com',
      },
      expiresAt: '2026-04-13T00:00:00.000Z',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
