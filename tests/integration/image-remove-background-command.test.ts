import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/files/upload.js');
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

describe('image remove-background command', () => {
  it('prints root help with remove-background discoverable', async () => {
    const result = await runCli(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist image remove-background');
  });

  it('prints image help with remove-background listed', async () => {
    const result = await runCli(['image', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist image remove-background --input <path>');
    expect(result.stdout).toContain('remove-background  Remove the background from an image through the API');
  });

  it('prints dedicated help for remove-background', async () => {
    const result = await runCli(['image', 'remove-background', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist image remove-background');
    expect(result.stdout).toContain('--input        Image file path');
    expect(result.stdout).toContain('--output       Download background-removed PNG to a local path');
  });

  it('creates an image.remove_background job with the uploaded source file', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: {
        'content-type': 'image/png',
      },
      filename: 'photo.png',
      mime_type: 'image/png',
      size_bytes: 12,
      file: {
        fileId: 'file_source_123',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(async () => {
      throw new Error('wait should not be called');
    });

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_background_123',
          status: 'queued',
          toolName: 'image.remove_background',
          toolVersion: '2026-04-20',
        },
      },
      request_id: 'req_create_job_background_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-background',
      '--input',
      '/tmp/photo.png',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(uploadCommand).toHaveBeenCalledWith({
      input: '/tmp/photo.png',
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      configPath: undefined,
    });
    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/jobs',
      body: expect.objectContaining({
        tool_name: 'image.remove_background',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_source_123',
        },
      }),
    });
    expect(waitJobCommand).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_background_123',
      status: 'queued',
      toolName: 'image.remove_background',
      toolVersion: '2026-04-20',
    });
    expect(result.stderr).toBe('');
  });

  it('resolves --env test to the hosted test base URL', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: {
        'content-type': 'image/png',
      },
      filename: 'photo.png',
      mime_type: 'image/png',
      size_bytes: 12,
      file: {
        fileId: 'file_source_123',
        status: 'uploaded',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_background_123',
          status: 'queued',
          toolName: 'image.remove_background',
          toolVersion: '2026-04-20',
        },
      },
      request_id: 'req_create_job_background_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-background',
      '--input',
      '/tmp/photo.png',
      '--env',
      'test',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(uploadCommand).toHaveBeenCalledWith({
      input: '/tmp/photo.png',
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_cli_secret',
      configPath: undefined,
    });
    expect(apiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://test.tooli.st',
        token: 'tgc_cli_secret',
      }),
    );
    expect(result.stderr).toBe('');
  });

  it('waits for completion, downloads the output, and prints the final job payload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-background-'));
    const outputPath = join(tempDir, 'photo-background-removed.png');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: {
        'content-type': 'image/png',
      },
      filename: 'photo.png',
      mime_type: 'image/png',
      size_bytes: 12,
      file: {
        fileId: 'file_source_123',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(async () => ({
      id: 'job_background_123',
      status: 'succeeded',
      toolName: 'image.remove_background',
      toolVersion: '2026-04-20',
      input: {
        input_file_id: 'file_source_123',
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/png',
          storageKey: 'ws/77/output/job_background_123/output.png',
        },
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_background_123',
          status: 'queued',
          toolName: 'image.remove_background',
          toolVersion: '2026-04-20',
        },
      },
      request_id: 'req_create_job_background_123',
    }));

    const fetch = vi.fn(async () => new Response(Buffer.from('transparent png bytes'), { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-background',
      '--input',
      '/tmp/photo.png',
      '--wait',
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
      jobId: 'job_background_123',
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      timeoutSeconds: 60,
      configPath: undefined,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/files/file_output_123/download',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tgc_cli_secret',
        }),
      }),
    );
    expect(await readFile(outputPath)).toEqual(Buffer.from('transparent png bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_background_123',
      status: 'succeeded',
      toolName: 'image.remove_background',
      toolVersion: '2026-04-20',
      input: {
        input_file_id: 'file_source_123',
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/png',
          storageKey: 'ws/77/output/job_background_123/output.png',
        },
      },
    });
    expect(result.stderr).toBe('');
  });

  it('prints backend job failure details before checking the background output file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-background-'));
    const outputPath = join(tempDir, 'photo-background-removed.png');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: {
        'content-type': 'image/png',
      },
      filename: 'photo.png',
      mime_type: 'image/png',
      size_bytes: 12,
      file: {
        fileId: 'file_source_123',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(async () => ({
      id: 'job_background_timed_out',
      status: 'timed_out',
      toolName: 'image.remove_background',
      toolVersion: '2026-04-20',
      errorCode: 'PROVIDER_TIMEOUT',
      errorMessage: 'Provider task timed out.',
      progress: {
        externalTaskId: 'provider_background_task_123',
        providerStatus: 'processing',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_background_timed_out',
          status: 'queued',
          toolName: 'image.remove_background',
          toolVersion: '2026-04-20',
        },
      },
      request_id: 'req_create_job_background_timed_out',
    }));

    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-background',
      '--input',
      '/tmp/photo.png',
      '--wait',
      '--output',
      outputPath,
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Job failed: job_background_timed_out');
    expect(result.stderr).toContain('Status: timed_out');
    expect(result.stderr).toContain('Error code: PROVIDER_TIMEOUT');
    expect(result.stderr).toContain('Error message: Provider task timed out.');
    expect(result.stderr).toContain('External task id: provider_background_task_123');
    expect(result.stderr).toContain('Provider status: processing');
    expect(result.stderr).not.toContain('did not produce an output file');
    expect(fetch).not.toHaveBeenCalled();
  });
});
