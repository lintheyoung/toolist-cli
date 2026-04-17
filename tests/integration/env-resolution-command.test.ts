import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loginCommand } from '../../src/commands/login.js';
import { logoutCommand } from '../../src/commands/logout.js';
import { whoamiCommand } from '../../src/commands/whoami.js';
import { loadConfig } from '../../src/lib/config.js';

afterEach(() => {
  vi.restoreAllMocks();
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
});
