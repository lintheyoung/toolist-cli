import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/jobs/get.js');
  vi.doUnmock('../../src/commands/jobs/wait.js');
  vi.doUnmock('../../src/commands/tools/list.js');
});

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

describe('tools list command', () => {
  it('dispatches tools list through the CLI and prints the JSON result', async () => {
    const listToolsCommand = vi.fn(async () => ({
      tools: [
        {
          name: 'image.convert_format',
          version: '2026-04-12',
          accepted_mime_types: ['image/jpeg', 'image/png'],
          max_file_size_bytes: 10_000_000,
        },
      ],
    }));

    vi.doMock('../../src/commands/tools/list.js', () => ({
      listToolsCommand,
    }));

    const result = await runCli([
      'tools',
      'list',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(listToolsCommand).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      configPath: undefined,
    });
    expect(JSON.parse(result.stdout)).toEqual({
      tools: [
        {
          name: 'image.convert_format',
          version: '2026-04-12',
          accepted_mime_types: ['image/jpeg', 'image/png'],
          max_file_size_bytes: 10_000_000,
        },
      ],
    });
    expect(result.stderr).toBe('');
  });

  it('reads the tool registry from the API', async () => {
    const apiRequest = vi.fn(async () => ({
      data: {
        tools: [
          {
            name: 'image.convert_format',
            version: '2026-04-12',
            accepted_mime_types: ['image/jpeg', 'image/png'],
            max_file_size_bytes: 10_000_000,
          },
        ],
      },
      request_id: 'req_tools_list_123',
    }));

    const { listToolsCommand } = await import('../../src/commands/tools/list.js');
    const result = await listToolsCommand(
      {
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'GET',
      path: '/api/v1/tools',
    });
    expect(result).toEqual({
      tools: [
        {
          name: 'image.convert_format',
          version: '2026-04-12',
          accepted_mime_types: ['image/jpeg', 'image/png'],
          max_file_size_bytes: 10_000_000,
        },
      ],
    });
  });

  it('uses saved credentials when only --config-path is provided', async () => {
    const listToolsCommand = vi.fn(async () => ({
      tools: [],
    }));

    vi.doMock('../../src/commands/tools/list.js', () => ({
      listToolsCommand,
    }));
    vi.doMock('../../src/lib/config.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/lib/config.js')>();
      return {
        ...actual,
        loadConfig: vi.fn(async () => ({
          activeEnvironment: 'prod',
          profiles: {
            prod: {
              environment: 'prod',
              baseUrl: 'https://saved.example.com',
              accessToken: 'saved_token_123',
            },
          },
        })),
      };
    });

    const result = await runCli([
      'tools',
      'list',
      '--config-path',
      '/tmp/toollist-config.json',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(listToolsCommand).toHaveBeenCalledWith({
      baseUrl: 'https://saved.example.com',
      token: 'saved_token_123',
      configPath: '/tmp/toollist-config.json',
    });
    expect(JSON.parse(result.stdout)).toEqual({
      tools: [],
    });
    expect(result.stderr).toBe('');
  });
});

describe('jobs commands', () => {
  it('dispatches jobs get through the CLI and prints the JSON result', async () => {
    const getJobCommand = vi.fn(async () => ({
      id: 'job_123',
      status: 'queued',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    }));

    vi.doMock('../../src/commands/jobs/get.js', () => ({
      getJobCommand,
    }));

    const result = await runCli([
      'jobs',
      'get',
      'job_123',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(getJobCommand).toHaveBeenCalledWith({
      jobId: 'job_123',
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      configPath: undefined,
    });
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_123',
      status: 'queued',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    });
    expect(result.stderr).toBe('');
  });

  it('resolves hosted environments for jobs get', async () => {
    const getJobCommand = vi.fn(async () => ({
      id: 'job_123',
      status: 'queued',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    }));

    vi.doMock('../../src/commands/jobs/get.js', () => ({
      getJobCommand,
    }));

    const result = await runCli([
      'jobs',
      'get',
      'job_123',
      '--env',
      'test',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(getJobCommand).toHaveBeenCalledWith({
      jobId: 'job_123',
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_cli_secret',
      configPath: undefined,
    });
    expect(result.stderr).toBe('');
  });

  it('dispatches jobs wait through the CLI and prints the JSON result', async () => {
    const waitJobCommand = vi.fn(async () => ({
      id: 'job_123',
      status: 'succeeded',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    }));

    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));

    const result = await runCli([
      'jobs',
      'wait',
      'job_123',
      '--timeout',
      '120',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_123',
      timeoutSeconds: 120,
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      configPath: undefined,
    });
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_123',
      status: 'succeeded',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    });
    expect(result.stderr).toBe('');
  });

  it('reads a job from the API', async () => {
    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_123',
          status: 'queued',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
        },
      },
      request_id: 'req_job_get_123',
    }));

    const { getJobCommand } = await import('../../src/commands/jobs/get.js');
    const result = await getJobCommand(
      {
        jobId: 'job_123',
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'GET',
      path: '/api/v1/jobs/job_123',
    });
    expect(result).toEqual({
      id: 'job_123',
      status: 'queued',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    });
  });

  it('falls back to the saved token when --token is provided as an empty string', async () => {
    const getJobCommand = vi.fn(async () => ({
      id: 'job_123',
      status: 'queued',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    }));

    vi.doMock('../../src/commands/jobs/get.js', () => ({
      getJobCommand,
    }));
    vi.doMock('../../src/lib/config.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/lib/config.js')>();
      return {
        ...actual,
        loadConfig: vi.fn(async () => ({
          activeEnvironment: 'prod',
          profiles: {
            prod: {
              environment: 'prod',
              baseUrl: 'https://saved.example.com',
              accessToken: 'saved_token_123',
            },
          },
        })),
      };
    });

    const result = await runCli([
      'jobs',
      'get',
      'job_123',
      '--config-path',
      '/tmp/toollist-config.json',
      '--token',
      '',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(getJobCommand).toHaveBeenCalledWith({
      jobId: 'job_123',
      baseUrl: 'https://saved.example.com',
      token: 'saved_token_123',
      configPath: '/tmp/toollist-config.json',
    });
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_123',
      status: 'queued',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    });
    expect(result.stderr).toBe('');
  });

  it('waits until a job reaches a terminal state', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'job_123',
        status: 'queued',
        toolName: 'image.convert_format',
        toolVersion: '2026-04-12',
      })
      .mockResolvedValueOnce({
        id: 'job_123',
        status: 'running',
        toolName: 'image.convert_format',
        toolVersion: '2026-04-12',
      })
      .mockResolvedValueOnce({
        id: 'job_123',
        status: 'succeeded',
        toolName: 'image.convert_format',
        toolVersion: '2026-04-12',
      });
    const sleep = vi.fn(async () => undefined);

    const { waitJobCommand } = await import('../../src/commands/jobs/wait.js');
    const result = await waitJobCommand(
      {
        jobId: 'job_123',
        timeoutSeconds: 120,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        getJob,
        sleep,
        now: () => 0,
      },
    );

    expect(getJob).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      id: 'job_123',
      status: 'succeeded',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    });
  });

  it('times out if a job only becomes terminal after the deadline', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'job_123',
        status: 'running',
        toolName: 'image.convert_format',
        toolVersion: '2026-04-12',
      })
      .mockResolvedValueOnce({
        id: 'job_123',
        status: 'succeeded',
        toolName: 'image.convert_format',
        toolVersion: '2026-04-12',
      });
    let currentTime = 0;
    const sleep = vi.fn(async (ms: number) => {
      currentTime += ms + 1;
    });

    const { waitJobCommand } = await import('../../src/commands/jobs/wait.js');

    await expect(
      waitJobCommand(
        {
          jobId: 'job_123',
          timeoutSeconds: 0.5,
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        {
          getJob,
          sleep,
          now: () => currentTime,
          pollIntervalMs: 2000,
        },
      ),
    ).rejects.toThrow('Timed out waiting for job job_123 after 0.5 seconds.');
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('fails fast on unknown flags and extra positional args', async () => {
    const unknownFlagResult = await runCli(['tools', 'list', '--bogus']);
    expect(unknownFlagResult.exitCode).toBe(1);
    expect(unknownFlagResult.stderr).toContain('Unknown option: --bogus');

    const extraPositionalResult = await runCli(['jobs', 'wait', 'job_123', 'extra']);
    expect(extraPositionalResult.exitCode).toBe(1);
    expect(extraPositionalResult.stderr).toContain('Unexpected positional argument: extra');
  });
});
