import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loginCommand } from '../../src/commands/login.js';
import { logoutCommand } from '../../src/commands/logout.js';
import { whoamiCommand } from '../../src/commands/whoami.js';
import { loadConfig } from '../../src/lib/config.js';
import { resolveEnvironmentBaseUrl } from '../../src/lib/environments.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

function createLoginDependencies(accessToken: string, baseUrl: string) {
  return {
    openBrowser: vi.fn(async () => undefined),
    announceBrowserLaunch: vi.fn(),
    startCallbackServer: vi.fn(async (expectedState: string) => ({
      redirectUri: 'http://localhost:45231/callback',
      waitForCallback: async () => ({
        code: `code-for-${accessToken}`,
        state: expectedState,
      }),
      close: async () => undefined,
    })),
    apiRequest: vi.fn(async () => ({
      data: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_at: '2026-04-13T00:00:00.000Z',
        workspace_id: 77,
        workspace_name: 'Acme',
        user_id: 11,
        user_email: 'agent@example.com',
        base_url: baseUrl,
        scopes: ['workspace:read', 'tools:read'],
      },
      request_id: `req-${accessToken}`,
    })),
    randomUUID: () => `state-${accessToken}`,
    createCodeVerifier: () => `verifier-${accessToken}`,
    createCodeChallenge: () => `challenge-${accessToken}`,
  };
}

async function runCli(args: string[]) {
  let stdout = '';
  let stderr = '';

  const { main } = await import('../../src/cli.js');
  const exitCode = await main(args, {
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });

  return { exitCode, stdout, stderr };
}

describe('CLI environment resolution', () => {
  it('saves test and prod credentials independently', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'toollist-env-resolution-'));
    const configPath = join(configDir, 'config.json');

    try {
      await loginCommand(
        {
          baseUrl: 'https://tooli.st',
          configPath,
        },
        createLoginDependencies('prod-token', 'https://tooli.st'),
      );

      await loginCommand(
        {
          baseUrl: 'https://test.tooli.st',
          configPath,
        },
        createLoginDependencies('test-token', 'https://test.tooli.st'),
      );

      expect(await loadConfig(configPath)).toEqual({
        activeEnvironment: 'test',
        profiles: {
          prod: {
            environment: 'prod',
            baseUrl: 'https://tooli.st',
            accessToken: 'prod-token',
          },
          test: {
            environment: 'test',
            baseUrl: 'https://test.tooli.st',
            accessToken: 'test-token',
          },
        },
      });

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
        request_id: 'req-whoami',
      }));

      await whoamiCommand(
        {
          configPath,
          env: 'prod',
        },
        {
          loadConfig,
          apiRequest,
        },
      );

      expect(apiRequest).toHaveBeenCalledWith({
        baseUrl: 'https://tooli.st',
        token: 'prod-token',
        method: 'GET',
        path: '/api/cli/me',
      });

      await logoutCommand({
        configPath,
        env: 'test',
      });

      expect(await loadConfig(configPath)).toEqual({
        activeEnvironment: 'prod',
        profiles: {
          prod: {
            environment: 'prod',
            baseUrl: 'https://tooli.st',
            accessToken: 'prod-token',
          },
        },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('migrates a legacy single-profile config into the matching non-prod environment', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'toollist-env-resolution-'));
    const configPath = join(configDir, 'config.json');

    try {
      await writeFile(configPath, JSON.stringify({
        baseUrl: 'https://test.tooli.st',
        accessToken: 'legacy-test-token',
      }));

      expect(await loadConfig(configPath)).toEqual({
        activeEnvironment: 'test',
        profiles: {
          test: {
            environment: 'test',
            baseUrl: 'https://test.tooli.st',
            accessToken: 'legacy-test-token',
          },
        },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('migrates a legacy self-hosted config into the active environment slot', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'toollist-env-resolution-'));
    const configPath = join(configDir, 'config.json');

    try {
      await writeFile(configPath, JSON.stringify({
        baseUrl: 'https://self-hosted.example.com',
        accessToken: 'legacy-self-hosted-token',
      }));

      expect(await loadConfig(configPath)).toEqual({
        activeEnvironment: 'prod',
        profiles: {
          prod: {
            environment: 'prod',
            baseUrl: 'https://self-hosted.example.com',
            accessToken: 'legacy-self-hosted-token',
          },
        },
      });

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
        request_id: 'req-whoami-self-hosted',
      }));

      await whoamiCommand(
        {
          configPath,
        },
        {
          loadConfig,
          apiRequest,
        },
      );

      expect(apiRequest).toHaveBeenCalledWith({
        baseUrl: 'https://self-hosted.example.com',
        token: 'legacy-self-hosted-token',
        method: 'GET',
        path: '/api/cli/me',
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('prefers --base-url over --env, TOOLIST_ENV, and the active config environment', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'toollist-env-resolution-'));
    const configPath = join(configDir, 'config.json');
    const listToolsCommand = vi.fn(async () => []);

    vi.resetModules();
    vi.doMock('../../src/commands/tools/list.js', () => ({
      listToolsCommand,
    }));

    try {
      await writeFile(configPath, JSON.stringify({
        activeEnvironment: 'dev',
        profiles: {
          dev: {
            environment: 'dev',
            baseUrl: 'http://localhost:3024',
            accessToken: 'dev-token',
          },
          test: {
            environment: 'test',
            baseUrl: 'https://custom-test.example.com',
            accessToken: 'test-token',
          },
        },
      }));

      vi.stubEnv('TOOLIST_ENV', 'test');

      const result = await runCli([
        'tools',
        'list',
        '--base-url',
        'https://override.example.com',
        '--env',
        'prod',
        '--config-path',
        configPath,
        '--token',
        'override-token',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(listToolsCommand).toHaveBeenCalledWith({
        baseUrl: 'https://override.example.com',
        token: 'override-token',
        configPath,
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('stores an explicit login --base-url in the authenticated slot even when TOOLIST_ENV and config point elsewhere', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'toollist-env-resolution-'));
    const configPath = join(configDir, 'config.json');
    const openBrowser = vi.fn(async () => undefined);
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
        access_token: 'self-hosted-token',
        token_type: 'Bearer',
        expires_at: '2026-04-13T00:00:00.000Z',
        workspace_id: 77,
        workspace_name: 'Acme',
        user_id: 11,
        user_email: 'agent@example.com',
        base_url: 'https://self-hosted.example.com',
        scopes: ['workspace:read', 'tools:read'],
      },
      request_id: 'req-login-self-hosted',
    }));

    vi.resetModules();
    vi.doMock('../../src/lib/browser.js', () => ({
      openBrowser,
    }));
    vi.doMock('../../src/lib/callback-server.js', () => ({
      startCallbackServer,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    try {
      await writeFile(configPath, JSON.stringify({
        activeEnvironment: 'dev',
        profiles: {
          dev: {
            environment: 'dev',
            baseUrl: 'http://localhost:3024',
            accessToken: 'dev-token',
          },
        },
      }));

      vi.stubEnv('TOOLIST_ENV', 'test');

      const result = await runCli([
        'login',
        '--base-url',
        'https://self-hosted.example.com',
        '--env',
        'prod',
        '--config-path',
        configPath,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain('Opening browser for Toolist login...');
      expect(openBrowser).toHaveBeenCalledTimes(1);
      expect(apiRequest).toHaveBeenCalledWith({
        baseUrl: 'https://self-hosted.example.com',
        method: 'POST',
        path: '/api/cli/auth/exchange',
        body: {
          code: 'code_123',
          state: expect.any(String),
          redirect_uri: 'http://localhost:45231/callback',
          code_verifier: expect.any(String),
        },
      });
      expect(await loadConfig(configPath)).toEqual({
        activeEnvironment: 'dev',
        profiles: {
          dev: {
            environment: 'dev',
            baseUrl: 'https://self-hosted.example.com',
            accessToken: 'self-hosted-token',
          },
        },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('prefers --env over TOOLIST_ENV and config when resolving hosted commands', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'toollist-env-resolution-'));
    const configPath = join(configDir, 'config.json');
    const listToolsCommand = vi.fn(async () => []);

    vi.resetModules();
    vi.doMock('../../src/commands/tools/list.js', () => ({
      listToolsCommand,
    }));

    try {
      await writeFile(configPath, JSON.stringify({
        activeEnvironment: 'dev',
        profiles: {
          prod: {
            environment: 'prod',
            baseUrl: 'https://custom-prod.example.com',
            accessToken: 'prod-token',
          },
          dev: {
            environment: 'dev',
            baseUrl: 'http://localhost:4010',
            accessToken: 'dev-token',
          },
        },
      }));

      vi.stubEnv('TOOLIST_ENV', 'dev');

      const result = await runCli([
        'tools',
        'list',
        '--env',
        'prod',
        '--config-path',
        configPath,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(listToolsCommand).toHaveBeenCalledWith({
        baseUrl: resolveEnvironmentBaseUrl('prod'),
        token: 'prod-token',
        configPath,
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('prefers TOOLIST_ENV over the active config environment for hosted commands', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'toollist-env-resolution-'));
    const configPath = join(configDir, 'config.json');
    const listToolsCommand = vi.fn(async () => []);

    vi.resetModules();
    vi.doMock('../../src/commands/tools/list.js', () => ({
      listToolsCommand,
    }));

    try {
      await writeFile(configPath, JSON.stringify({
        activeEnvironment: 'prod',
        profiles: {
          prod: {
            environment: 'prod',
            baseUrl: 'https://custom-prod.example.com',
            accessToken: 'prod-token',
          },
          test: {
            environment: 'test',
            baseUrl: 'https://custom-test.example.com',
            accessToken: 'test-token',
          },
        },
      }));

      vi.stubEnv('TOOLIST_ENV', 'test');

      const result = await runCli([
        'tools',
        'list',
        '--config-path',
        configPath,
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(listToolsCommand).toHaveBeenCalledWith({
        baseUrl: resolveEnvironmentBaseUrl('test'),
        token: 'test-token',
        configPath,
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });
});
