import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('../../src/commands/logout.js');
});

describe('logout command', () => {
  it('dispatches logout through the CLI and prints the JSON result', async () => {
    const logoutCommand = vi.fn(async () => ({
      loggedOut: true,
    }));

    vi.doMock('../../src/commands/logout.js', () => ({
      logoutCommand,
    }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    let stderr = '';

    const exitCode = await main(['logout', '--config-path', '/tmp/toollist-config.json', '--env', 'test', '--json'], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    });

    expect(exitCode).toBe(0);
    expect(logoutCommand).toHaveBeenCalledWith({
      configPath: '/tmp/toollist-config.json',
      env: 'test',
    });
    expect(JSON.parse(stdout)).toEqual({
      loggedOut: true,
    });
    expect(stderr).toBe('');
  });

  it('clears the saved config file', async () => {
    const { logoutCommand } = await import('../../src/commands/logout.js');

    const loadConfig = vi.fn(async () => ({
      activeEnvironment: 'test' as const,
      profiles: {
        test: {
          environment: 'test' as const,
          baseUrl: 'https://test.tooli.st',
          accessToken: 'tgc_cli_secret',
        },
      },
    }));
    const clearConfig = vi.fn(async () => undefined);

    const result = await logoutCommand(
      {
        configPath: '/tmp/toollist-config.json',
        env: 'test',
      },
      {
        loadConfig,
        clearConfig,
      },
    );

    expect(loadConfig).toHaveBeenCalledWith('/tmp/toollist-config.json');
    expect(clearConfig).toHaveBeenCalledWith('/tmp/toollist-config.json');
    expect(result).toEqual({
      loggedOut: true,
    });
  });

  it('clears a self-hosted login stored in the active environment slot when no env is specified', async () => {
    const { logoutCommand } = await import('../../src/commands/logout.js');

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
    const clearConfig = vi.fn(async () => undefined);

    const result = await logoutCommand(
      {
        configPath: '/tmp/toollist-config.json',
      },
      {
        loadConfig,
        clearConfig,
      },
    );

    expect(clearConfig).toHaveBeenCalledWith('/tmp/toollist-config.json');
    expect(result).toEqual({
      loggedOut: true,
    });
  });

  it('logs out the selected hosted env slot even if it stores a self-hosted URL', async () => {
    const { logoutCommand } = await import('../../src/commands/logout.js');

    const loadConfig = vi.fn(async () => ({
      activeEnvironment: 'prod' as const,
      profiles: {
        prod: {
          environment: 'prod' as const,
          baseUrl: 'https://self-hosted.example.com',
          accessToken: 'tgc_cli_secret',
        },
        test: {
          environment: 'test' as const,
          baseUrl: 'https://test.tooli.st',
          accessToken: 'test-secret',
        },
      },
    }));
    const clearConfig = vi.fn(async () => undefined);
    const saveConfig = vi.fn(async () => undefined);

    const result = await logoutCommand(
      {
        configPath: '/tmp/toollist-config.json',
        env: 'prod',
      },
      {
        loadConfig,
        clearConfig,
        saveConfig,
      },
    );

    expect(saveConfig).toHaveBeenCalledWith({
      activeEnvironment: 'test',
      profiles: {
        test: {
          environment: 'test',
          baseUrl: 'https://test.tooli.st',
          accessToken: 'test-secret',
        },
      },
    }, '/tmp/toollist-config.json');
    expect(clearConfig).not.toHaveBeenCalled();
    expect(result).toEqual({
      loggedOut: true,
    });
  });

  it('uses TOOLIST_ENV to select the hosted env slot to clear', async () => {
    const { logoutCommand } = await import('../../src/commands/logout.js');

    vi.stubEnv('TOOLIST_ENV', 'prod');

    const loadConfig = vi.fn(async () => ({
      activeEnvironment: 'test' as const,
      profiles: {
        prod: {
          environment: 'prod' as const,
          baseUrl: 'https://self-hosted.example.com',
          accessToken: 'tgc_cli_secret',
        },
        test: {
          environment: 'test' as const,
          baseUrl: 'https://test.tooli.st',
          accessToken: 'test-secret',
        },
      },
    }));
    const clearConfig = vi.fn(async () => undefined);
    const saveConfig = vi.fn(async () => undefined);

    await logoutCommand(
      {
        configPath: '/tmp/toollist-config.json',
      },
      {
        loadConfig,
        clearConfig,
        saveConfig,
      },
    );

    expect(saveConfig).toHaveBeenCalledWith({
      activeEnvironment: 'test',
      profiles: {
        test: {
          environment: 'test',
          baseUrl: 'https://test.tooli.st',
          accessToken: 'test-secret',
        },
      },
    }, '/tmp/toollist-config.json');
    expect(clearConfig).not.toHaveBeenCalled();
  });
});
