import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
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

    const exitCode = await main(['logout', '--config-path', '/tmp/toollist-config.json', '--json'], {
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
    });
    expect(JSON.parse(stdout)).toEqual({
      loggedOut: true,
    });
    expect(stderr).toBe('');
  });

  it('clears the saved config file', async () => {
    const { logoutCommand } = await import('../../src/commands/logout.js');

    const clearConfig = vi.fn(async () => undefined);

    const result = await logoutCommand(
      {
        configPath: '/tmp/toollist-config.json',
      },
      {
        clearConfig,
      },
    );

    expect(clearConfig).toHaveBeenCalledWith('/tmp/toollist-config.json');
    expect(result).toEqual({
      loggedOut: true,
    });
  });
});
