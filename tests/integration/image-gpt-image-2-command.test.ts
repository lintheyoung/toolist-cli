import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/jobs/wait.js');
  vi.doUnmock('../../src/lib/http.js');
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

describe('image gpt-image-2 command', () => {
  it('prints help with gpt-image-2 discoverable', async () => {
    const rootHelp = await runCli(['--help']);
    const imageHelp = await runCli(['image', '--help']);
    const commandHelp = await runCli(['image', 'gpt-image-2', '--help']);

    expect(rootHelp.exitCode).toBe(0);
    expect(rootHelp.stdout).toContain('toollist image gpt-image-2');
    expect(imageHelp.exitCode).toBe(0);
    expect(imageHelp.stdout).toContain('toollist image gpt-image-2 --prompt <text>');
    expect(imageHelp.stdout).toContain('gpt-image-2  Generate an image with Kie GPT Image 2 through the API');
    expect(commandHelp.exitCode).toBe(0);
    expect(commandHelp.stdout).toContain('toollist image gpt-image-2');
    expect(commandHelp.stdout).toContain('--prompt       Text prompt for image generation');
    expect(commandHelp.stdout).toContain('--aspect-ratio Aspect ratio, for example auto, 1:1, 16:9, or 9:16');
  });

  it('fails clearly when --prompt is missing', async () => {
    const result = await runCli([
      'image',
      'gpt-image-2',
      '--aspect-ratio',
      '1:1',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Missing required option: --prompt');
  });

  it('creates an image.gpt_image_2_text_to_image job from prompt and aspect ratio', async () => {
    const waitJobCommand = vi.fn(async () => {
      throw new Error('wait should not be called');
    });

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_gpt_image_2_123',
          status: 'queued',
          toolName: 'image.gpt_image_2_text_to_image',
          toolVersion: '2026-04-26',
        },
      },
      request_id: 'req_create_job_gpt_image_2_123',
    }));

    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'gpt-image-2',
      '--prompt',
      'Create a clean square app icon.',
      '--aspect-ratio',
      '1:1',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/jobs',
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: expect.objectContaining({
        tool_name: 'image.gpt_image_2_text_to_image',
        idempotency_key: expect.any(String),
        input: {
          prompt: 'Create a clean square app icon.',
          aspect_ratio: '1:1',
        },
      }),
    }));
    expect(waitJobCommand).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_gpt_image_2_123',
      status: 'queued',
      toolName: 'image.gpt_image_2_text_to_image',
      toolVersion: '2026-04-26',
    });
    expect(result.stderr.split('\n').filter(Boolean)).toEqual([
      'Creating job...',
      'Created job: job_gpt_image_2_123',
    ]);
  });

  it('waits for completion, downloads output, and keeps stdout as final JSON', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-gpt-image-2-'));
    const outputPath = join(tempDir, 'generated.png');

    const waitJobCommand = vi.fn(
      async (args: { onStatus?: (status: string, job: unknown) => void }) => {
        args.onStatus?.('running', {
          id: 'job_gpt_image_2_123',
          status: 'running',
          toolName: 'image.gpt_image_2_text_to_image',
          toolVersion: '2026-04-26',
        });
        args.onStatus?.('succeeded', {
          id: 'job_gpt_image_2_123',
          status: 'succeeded',
          toolName: 'image.gpt_image_2_text_to_image',
          toolVersion: '2026-04-26',
        });
        return {
          id: 'job_gpt_image_2_123',
          status: 'succeeded',
          toolName: 'image.gpt_image_2_text_to_image',
          toolVersion: '2026-04-26',
          input: {
            prompt: 'Create a clean square app icon.',
            aspect_ratio: '1:1',
          },
          result: {
            output: {
              outputFileId: 'file_gpt_image_2_output_123',
              mimeType: 'image/png',
              storageBucket: 'toollist-staging',
            },
          },
        };
      },
    );

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_gpt_image_2_123',
          status: 'queued',
          toolName: 'image.gpt_image_2_text_to_image',
          toolVersion: '2026-04-26',
        },
      },
      request_id: 'req_create_job_gpt_image_2_123',
    }));

    const fetch = vi.fn(async () => new Response(Buffer.from('generated png bytes'), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'gpt-image-2',
      '--prompt',
      'Create a clean square app icon.',
      '--aspect-ratio',
      '1:1',
      '--wait',
      '--timeout',
      '900',
      '--output',
      outputPath,
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_gpt_image_2_123',
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      timeoutSeconds: 900,
      configPath: undefined,
      onStatus: expect.any(Function),
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/files/file_gpt_image_2_output_123/download',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tgc_cli_secret',
        }),
      }),
    );
    expect(await readFile(outputPath)).toEqual(Buffer.from('generated png bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_gpt_image_2_123',
      status: 'succeeded',
      toolName: 'image.gpt_image_2_text_to_image',
      toolVersion: '2026-04-26',
      input: {
        prompt: 'Create a clean square app icon.',
        aspect_ratio: '1:1',
      },
      result: {
        output: {
          outputFileId: 'file_gpt_image_2_output_123',
          mimeType: 'image/png',
          storageBucket: 'toollist-staging',
        },
      },
    });
    expect(result.stderr.split('\n').filter(Boolean)).toEqual([
      'Creating job...',
      'Created job: job_gpt_image_2_123',
      'Waiting for job...',
      'Status: queued',
      'Status: running',
      'Status: succeeded',
      'Downloading output: file_gpt_image_2_output_123',
      `Saved output: ${outputPath}`,
    ]);
  });

  it('prints hosted job failure details to stderr and leaves stdout empty', async () => {
    const waitJobCommand = vi.fn(async () => ({
      id: 'job_gpt_image_2_failed',
      status: 'failed',
      toolName: 'image.gpt_image_2_text_to_image',
      toolVersion: '2026-04-26',
      errorCode: 'PROVIDER_TASK_FAILED',
      errorMessage: 'Kie task failed.',
      progress: {
        externalTaskId: 'kie_task_123',
        providerStatus: 'failed',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_gpt_image_2_failed',
          status: 'queued',
          toolName: 'image.gpt_image_2_text_to_image',
          toolVersion: '2026-04-26',
        },
      },
      request_id: 'req_create_job_gpt_image_2_failed',
    }));

    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'gpt-image-2',
      '--prompt',
      'Create a clean square app icon.',
      '--wait',
      '--output',
      '/tmp/generated.png',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Job failed: job_gpt_image_2_failed');
    expect(result.stderr).toContain('Status: failed');
    expect(result.stderr).toContain('Error code: PROVIDER_TASK_FAILED');
    expect(result.stderr).toContain('Error message: Kie task failed.');
    expect(result.stderr).toContain('External task id: kie_task_123');
    expect(result.stderr).toContain('Provider status: failed');
    expect(fetch).not.toHaveBeenCalled();
  });
});
