import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTwitterWatchCommandHash, twitterWatchPollRemoteCommand, twitterWatchTrustCommand } from '../../src/commands/twitter/watch.js';

const tweet = {
  id: 'tweet_1',
  url: 'https://x.com/alice/status/tweet_1',
  text: 'hello from x',
  author: {
    userName: 'alice',
  },
  createdAt: '2026-04-27T01:02:03.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock('../../src/commands/twitter/watch.js');
});

describe('twitter watch command', () => {
  it('shows twitter watch poll and trust help from the CLI', async () => {
    const { main } = await import('../../src/cli.js');

    let stdout = '';
    const exitCode = await main(['twitter', 'watch', '--help'], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: () => {},
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('toollist twitter watch');
    expect(stdout).toContain('poll');
    expect(stdout).toContain('trust');
  });

  it('dispatches remote poll through the CLI', async () => {
    const twitterWatchPollRemoteCommandMock = vi.fn(async () => ({
      remote: true,
      once: true,
      intervalSeconds: null,
      watches: [],
      totals: {
        watches: 0,
        events: 0,
        executed: 0,
        skipped: 0,
        failed: 0,
        requires_trust: 0,
      },
    }));

    vi.doMock('../../src/commands/twitter/watch.js', () => ({
      twitterWatchPollRemoteCommand: twitterWatchPollRemoteCommandMock,
      twitterWatchTrustCommand: vi.fn(),
    }));

    const { main } = await import('../../src/cli.js');

    let stdout = '';
    const exitCode = await main([
      'twitter',
      'watch',
      'poll',
      '--remote',
      '--once',
      '--env',
      'test',
      '--token',
      'tgc_test',
      '--config-path',
      '/tmp/toollist-config.json',
      '--json',
    ], {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: () => {},
    });

    expect(exitCode).toBe(0);
    expect(twitterWatchPollRemoteCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_test',
      configPath: '/tmp/toollist-config.json',
      remote: true,
      once: true,
    }));
    expect(JSON.parse(stdout)).toEqual(expect.objectContaining({ remote: true, once: true }));
  });

  it('fetches remote watches and does not execute baseline events', async () => {
    const apiRequest = vi.fn(async (request) => {
      if (request.method === 'GET') {
        return {
          data: {
            watches: [{
              id: 'watch_1',
              commandTemplate: 'echo {{tweet.id}}',
            }],
          },
        };
      }

      return {
        data: {
          watchId: 'watch_1',
          baseline: true,
          events: [tweet],
        },
      };
    });
    const executeCommand = vi.fn();

    const result = await twitterWatchPollRemoteCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_test',
      remote: true,
      once: true,
    }, {
      apiRequest,
      executeCommand,
      readTrustedCommands: vi.fn(async () => new Set()),
    });

    expect(apiRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: 'GET',
      path: '/api/cli/twitter/watch/remote',
    }));
    expect(apiRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: 'POST',
      path: '/api/cli/twitter/watch/watch_1/poll',
    }));
    expect(executeCommand).not.toHaveBeenCalled();
    expect(result.watches[0]?.executions[0]).toEqual(expect.objectContaining({
      tweetId: 'tweet_1',
      status: 'baseline_skipped',
      requires_trust: false,
    }));
  });

  it('skips untrusted commands and reports the command hash', async () => {
    const apiRequest = vi.fn(async (request) => {
      if (request.method === 'GET') {
        return { data: { watches: [{ id: 'watch_1', commandTemplate: 'echo {{tweet.id}}' }] } };
      }
      return { data: { watchId: 'watch_1', baseline: false, events: [tweet] } };
    });
    const executeCommand = vi.fn();

    const result = await twitterWatchPollRemoteCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_test',
      remote: true,
      once: true,
    }, {
      apiRequest,
      executeCommand,
      readTrustedCommands: vi.fn(async () => new Set()),
    });

    expect(executeCommand).not.toHaveBeenCalled();
    expect(result.watches[0]?.commandHash).toBe(createTwitterWatchCommandHash('echo {{tweet.id}}'));
    expect(result.watches[0]?.executions[0]).toEqual(expect.objectContaining({
      status: 'skipped_untrusted',
      requires_trust: true,
      command: "echo 'tweet_1'",
    }));
    expect(result.totals.requires_trust).toBe(1);
  });

  it('renders variables, executes trusted commands, and reports success', async () => {
    const commandTemplate = 'printf "%s|%s|%s|%s|%s" {{tweet.id}} {{tweet.url}} {{tweet.text}} {{tweet.author.userName}} {{tweet.createdAt}}';
    const apiRequest = vi.fn(async (request) => {
      if (request.method === 'GET') {
        return { data: { watches: [{ id: 'watch_1', commandTemplate }] } };
      }
      if (request.path.endsWith('/executions')) {
        return { data: { ok: true } };
      }
      return { data: { watchId: 'watch_1', baseline: false, events: [tweet] } };
    });
    const executeCommand = vi.fn(async () => ({
      stdout: 'tweet_1|https://x.com/alice/status/tweet_1|hello from x|alice|2026-04-27T01:02:03.000Z',
      stderr: '',
      exitCode: 0,
    }));

    const result = await twitterWatchPollRemoteCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_test',
      remote: true,
      once: true,
    }, {
      apiRequest,
      executeCommand,
      readTrustedCommands: vi.fn(async () => new Set([`watch_1:${createTwitterWatchCommandHash(commandTemplate)}`])),
    });

    expect(executeCommand).toHaveBeenCalledWith('printf "%s|%s|%s|%s|%s" \'tweet_1\' \'https://x.com/alice/status/tweet_1\' \'hello from x\' \'alice\' \'2026-04-27T01:02:03.000Z\'');
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      path: '/api/cli/twitter/watch/watch_1/executions',
      body: expect.objectContaining({
        tweetId: 'tweet_1',
        commandHash: createTwitterWatchCommandHash(commandTemplate),
        stdout: expect.stringContaining('tweet_1|https://x.com/alice/status/tweet_1'),
        stderr: '',
        exitCode: 0,
        status: 'success',
      }),
    }));
    expect(result.watches[0]?.executions[0]).toEqual(expect.objectContaining({
      status: 'success',
      exitCode: 0,
      stdout: expect.stringContaining('tweet_1|https://x.com/alice/status/tweet_1'),
    }));
  });

  it('reports command failure when a trusted command exits non-zero', async () => {
    const commandTemplate = 'false';
    const apiRequest = vi.fn(async (request) => {
      if (request.method === 'GET') {
        return { data: { watches: [{ id: 'watch_1', commandTemplate }] } };
      }
      if (request.path.endsWith('/executions')) {
        return { data: { ok: true } };
      }
      return { data: { watchId: 'watch_1', baseline: false, events: [tweet] } };
    });
    const executeCommand = vi.fn(async () => ({ stdout: '', stderr: 'nope', exitCode: 2 }));

    const result = await twitterWatchPollRemoteCommand({
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_test',
      remote: true,
      once: true,
    }, {
      apiRequest,
      executeCommand,
      readTrustedCommands: vi.fn(async () => new Set([`watch_1:${createTwitterWatchCommandHash(commandTemplate)}`])),
    });

    expect(result.watches[0]?.executions[0]).toEqual(expect.objectContaining({
      status: 'failed',
      exitCode: 2,
      stderr: 'nope',
    }));
    expect(result.totals.failed).toBe(1);
  });

  it('trusts a watch command hash in a local trust file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-twitter-watch-'));
    const trustPath = join(tempDir, 'trust.json');

    try {
      const result = await twitterWatchTrustCommand({
        watchId: 'watch_1',
        commandHash: 'abc123',
        trustPath,
      });

      expect(result).toEqual({
        watchId: 'watch_1',
        commandHash: 'abc123',
        trusted: true,
        trustPath,
      });
      expect(JSON.parse(await readFile(trustPath, 'utf8'))).toEqual({
        trustedCommands: [{ watchId: 'watch_1', commandHash: 'abc123' }],
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
