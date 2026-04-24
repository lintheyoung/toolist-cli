import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('../../src/commands/whoami.js');
});

describe('whoami command', () => {
  it('dispatches whoami through the CLI and prints the JSON result', async () => {
    const whoamiCommand = vi.fn(async () => ({
      user: {
        id: 11,
        email: 'agent@example.com',
      },
      workspace: {
        id: 77,
        name: 'Acme',
      },
      scopes: ['workspace:read', 'tools:read'],
      active_job_count: 2,
      max_concurrent_jobs: 5,
    }));

    vi.doMock('../../src/commands/whoami.js', () => ({
      whoamiCommand,
    }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';

    const exitCode = await main(['whoami', '--config-path', '/tmp/toollist-config.json', '--env', 'test', '--json'], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(0);
    expect(whoamiCommand).toHaveBeenCalledWith({
      configPath: '/tmp/toollist-config.json',
      env: 'test',
    });
    expect(JSON.parse(stdout)).toEqual({
      user: {
        id: 11,
        email: 'agent@example.com',
      },
      workspace: {
        id: 77,
        name: 'Acme',
      },
      scopes: ['workspace:read', 'tools:read'],
      active_job_count: 2,
      max_concurrent_jobs: 5,
    });
    expect(stderr).toBe('');
  });

  it('reads the saved config and fetches the current identity', async () => {
    const { whoamiCommand } = await import('../../src/commands/whoami.js');

    const loadConfig = vi.fn(async () => ({
      activeEnvironment: 'dev' as const,
      profiles: {
        dev: {
          environment: 'dev' as const,
          baseUrl: 'http://localhost:3024',
          accessToken: 'tgc_cli_secret',
        },
      },
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        user: {
          id: 11,
          email: 'agent@example.com',
        },
        workspace: {
          id: 77,
          name: 'Acme',
        },
        scopes: ['workspace:read', 'tools:read'],
        active_job_count: 2,
        max_concurrent_jobs: 5,
      },
      request_id: 'req_whoami_123',
    }));

    const result = await whoamiCommand(
      {
        configPath: '/tmp/toollist-config.json',
        env: 'dev',
      },
      {
        loadConfig,
        apiRequest,
      },
    );

    expect(loadConfig).toHaveBeenCalledWith('/tmp/toollist-config.json');
    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:3024',
      token: 'tgc_cli_secret',
      method: 'GET',
      path: '/api/cli/me',
      stage: 'Whoami request failed',
      retry: {
        attempts: 4,
        delaysMs: [1000, 3000, 7000],
      },
    });
    expect(result).toEqual({
      user: {
        id: 11,
        email: 'agent@example.com',
      },
      workspace: {
        id: 77,
        name: 'Acme',
      },
      scopes: ['workspace:read', 'tools:read'],
      active_job_count: 2,
      max_concurrent_jobs: 5,
    });
  });

  it('uses a self-hosted login stored in the active environment slot when no env is specified', async () => {
    const { whoamiCommand } = await import('../../src/commands/whoami.js');

    const loadConfig = vi.fn(async () => ({
      activeEnvironment: 'prod' as const,
      profiles: {
        prod: {
          environment: 'prod' as const,
          baseUrl: 'https://self-hosted.example.com',
          accessToken: 'tgc_cli_secret',
        },
      },
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        user: {
          id: 11,
          email: 'agent@example.com',
        },
        workspace: {
          id: 77,
          name: 'Acme',
        },
        scopes: ['workspace:read', 'tools:read'],
        active_job_count: 2,
        max_concurrent_jobs: 5,
      },
      request_id: 'req_whoami_self_hosted',
    }));

    await whoamiCommand(
      {
        configPath: '/tmp/toollist-config.json',
      },
      {
        loadConfig,
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://self-hosted.example.com',
      token: 'tgc_cli_secret',
      method: 'GET',
      path: '/api/cli/me',
      stage: 'Whoami request failed',
      retry: {
        attempts: 4,
        delaysMs: [1000, 3000, 7000],
      },
    });
  });

  it('uses the canonical hosted base URL for an explicit env even if that slot stores a self-hosted URL', async () => {
    const { whoamiCommand } = await import('../../src/commands/whoami.js');

    const loadConfig = vi.fn(async () => ({
      activeEnvironment: 'prod' as const,
      profiles: {
        prod: {
          environment: 'prod' as const,
          baseUrl: 'https://self-hosted.example.com',
          accessToken: 'tgc_cli_secret',
        },
      },
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        user: {
          id: 11,
          email: 'agent@example.com',
        },
        workspace: {
          id: 77,
          name: 'Acme',
        },
        scopes: ['workspace:read', 'tools:read'],
        active_job_count: 2,
        max_concurrent_jobs: 5,
      },
      request_id: 'req_whoami_prod',
    }));

    await whoamiCommand(
      {
        configPath: '/tmp/toollist-config.json',
        env: 'prod',
      },
      {
        loadConfig,
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://tooli.st',
      token: 'tgc_cli_secret',
      method: 'GET',
      path: '/api/cli/me',
      stage: 'Whoami request failed',
      retry: {
        attempts: 4,
        delaysMs: [1000, 3000, 7000],
      },
    });
  });

  it('uses the canonical hosted base URL for TOOLIST_ENV even if that slot stores a self-hosted URL', async () => {
    const { whoamiCommand } = await import('../../src/commands/whoami.js');

    vi.stubEnv('TOOLIST_ENV', 'prod');

    const loadConfig = vi.fn(async () => ({
      activeEnvironment: 'test' as const,
      profiles: {
        prod: {
          environment: 'prod' as const,
          baseUrl: 'https://self-hosted.example.com',
          accessToken: 'tgc_cli_secret',
        },
      },
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        user: {
          id: 11,
          email: 'agent@example.com',
        },
        workspace: {
          id: 77,
          name: 'Acme',
        },
        scopes: ['workspace:read', 'tools:read'],
        active_job_count: 2,
        max_concurrent_jobs: 5,
      },
      request_id: 'req_whoami_prod_envvar',
    }));

    await whoamiCommand(
      {
        configPath: '/tmp/toollist-config.json',
      },
      {
        loadConfig,
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://tooli.st',
      token: 'tgc_cli_secret',
      method: 'GET',
      path: '/api/cli/me',
      stage: 'Whoami request failed',
      retry: {
        attempts: 4,
        delaysMs: [1000, 3000, 7000],
      },
    });
  });

  it('retries transient whoami transport failures and keeps JSON output clean', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              user: {
                id: 11,
                email: 'agent@example.com',
              },
              workspace: {
                id: 77,
                name: 'Acme',
              },
              scopes: ['workspace:read'],
              active_job_count: 0,
              max_concurrent_jobs: 5,
            },
            request_id: 'req_whoami_retry',
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

    const { createStderrRetryReporter } = await import('../../src/lib/retry.js');
    const { whoamiCommand } = await import('../../src/commands/whoami.js');

    let stderr = '';
    const result = await whoamiCommand(
      {
        configPath: '/tmp/toollist-config.json',
        env: 'dev',
        onRetry: createStderrRetryReporter((chunk) => {
          stderr += chunk;
        }),
      },
      {
        loadConfig: vi.fn(async () => ({
          activeEnvironment: 'dev' as const,
          profiles: {
            dev: {
              environment: 'dev' as const,
              baseUrl: 'http://localhost:3024',
              accessToken: 'tgc_cli_secret',
            },
          },
        })),
      },
    );

    expect(result.user.id).toBe(11);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(stderr).toContain('Whoami request failed: fetch failed\n');
    expect(stderr).toContain('Retrying whoami request (1/4) in 1000ms...\n');
  });
});
