import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('node:fs/promises');
});

describe('config storage', () => {
  it('writes config to the default user config path and reads it back', async () => {
    const { loadConfig, saveConfig } = await import('../../src/lib/config.js');
    const configHome = await mkdtemp(join(tmpdir(), 'toollist-config-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHome);

    const config = {
      activeEnvironment: 'prod' as const,
      profiles: {
        prod: {
          environment: 'prod' as const,
          baseUrl: 'https://tooli.st',
          accessToken: 'tgc_cli_secret',
        },
      },
    };

    await saveConfig(config);

    const configPath = join(configHome, 'toollist', 'config.json');
    const stored = JSON.parse(await readFile(configPath, 'utf8')) as typeof config;

    expect(stored).toEqual(config);
    expect(await loadConfig()).toEqual(config);

    await rm(configHome, { recursive: true, force: true });
  });

  it('clears the saved token from the default user config path', async () => {
    const { clearConfig, loadConfig, saveConfig } = await import('../../src/lib/config.js');
    const configHome = await mkdtemp(join(tmpdir(), 'toollist-config-'));
    vi.stubEnv('XDG_CONFIG_HOME', configHome);

    await saveConfig({
      activeEnvironment: 'prod',
      profiles: {
        prod: {
          environment: 'prod',
          baseUrl: 'https://tooli.st',
          accessToken: 'tgc_cli_secret',
        },
      },
    });

    await clearConfig();

    expect(await loadConfig()).toBeNull();

    await rm(configHome, { recursive: true, force: true });
  });

  it('writes config atomically through a temp file before renaming', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-config-atomic-'));
    const rename = vi.fn(async (from: string, to: string) => {
    });
    const writeFile = vi.fn(async (path: string, data: string, options: unknown) => {
    });

    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>();
      return {
        ...actual,
        rename,
        writeFile,
      };
    });

    const { saveConfig: mockedSaveConfig } = await import('../../src/lib/config.js');

    await mockedSaveConfig(
      {
        activeEnvironment: 'prod',
        profiles: {
          prod: {
            environment: 'prod',
            baseUrl: 'https://tooli.st',
            accessToken: 'tgc_cli_secret',
          },
        },
      },
      join(tempDir, 'config.json'),
    );

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);

    const [writtenPath, , options] = writeFile.mock.calls[0]!;
    const [renamedFrom, renamedTo] = rename.mock.calls[0]!;

    expect(String(writtenPath)).toContain('.tmp-');
    expect(String(renamedTo)).toBe(join(tempDir, 'config.json'));
    expect(renamedFrom).toBe(writtenPath);
    expect(options).toMatchObject({ mode: 0o600 });

    vi.doUnmock('node:fs/promises');
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses restrictive permissions when writing config on Unix-like systems', async () => {
    const { saveConfig } = await import('../../src/lib/config.js');
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-config-perms-'));
    await saveConfig(
      {
        activeEnvironment: 'prod',
        profiles: {
          prod: {
            environment: 'prod',
            baseUrl: 'https://tooli.st',
            accessToken: 'tgc_cli_secret',
          },
        },
      },
      join(tempDir, 'config.json'),
    );

    const fileStats = await stat(join(tempDir, 'config.json'));
    expect(fileStats.mode & 0o777).toBe(0o600);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('migrates a legacy self-hosted config into a readable active profile', async () => {
    const { loadConfig } = await import('../../src/lib/config.js');
    const configDir = await mkdtemp(join(tmpdir(), 'toollist-config-legacy-'));
    const configPath = join(configDir, 'config.json');

    await writeFile(configPath, `${JSON.stringify({
      baseUrl: 'https://self-hosted.example.com',
      accessToken: 'tgc_cli_secret',
    }, null, 2)}\n`);

    expect(await loadConfig(configPath)).toEqual({
      activeEnvironment: 'prod',
      activeProfile: {
        baseUrl: 'https://self-hosted.example.com',
        accessToken: 'tgc_cli_secret',
      },
      profiles: {},
    });

    await rm(configDir, { recursive: true, force: true });
  });
});
