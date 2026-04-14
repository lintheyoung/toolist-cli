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

describe('image remove-watermark command', () => {
  it('dispatches image remove-watermark through the CLI, waits for completion, downloads the output, and prints the final job payload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const outputPath = join(tempDir, 'photo-clean.png');

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
      id: 'job_watermark_123',
      status: 'succeeded',
      toolName: 'image.gemini_nb_remove_watermark',
      toolVersion: '2026-04-15',
      input: {
        input_file_id: 'file_source_123',
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/png',
          storageKey: 'ws/77/output/job_watermark_123/output.png',
        },
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_watermark_123',
          status: 'queued',
          toolName: 'image.gemini_nb_remove_watermark',
          toolVersion: '2026-04-15',
        },
      },
      request_id: 'req_create_job_watermark_123',
    }));

    const downloadResponse = new Response(Buffer.from('clean png bytes'), {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
    });
    const fetch = vi.fn(async () => downloadResponse);
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
      'remove-watermark',
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
        tool_name: 'image.gemini_nb_remove_watermark',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_source_123',
        },
      }),
    });
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_watermark_123',
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
    expect(await readFile(outputPath)).toEqual(Buffer.from('clean png bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_watermark_123',
      status: 'succeeded',
      toolName: 'image.gemini_nb_remove_watermark',
      toolVersion: '2026-04-15',
      input: {
        input_file_id: 'file_source_123',
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/png',
          storageKey: 'ws/77/output/job_watermark_123/output.png',
        },
      },
    });
    expect(result.stderr).toBe('');
  });

  it('skips waitJobCommand and downloads directly when the create-job response is already terminal and --output is set', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const outputPath = join(tempDir, 'photo-clean.png');

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
          id: 'job_watermark_123',
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark',
          toolVersion: '2026-04-15',
          input: {
            input_file_id: 'file_source_123',
          },
          result: {
            output: {
              outputFileId: 'file_output_123',
              mimeType: 'image/png',
              storageKey: 'ws/77/output/job_watermark_123/output.png',
            },
          },
        },
      },
      request_id: 'req_create_job_watermark_123',
    }));

    const downloadResponse = new Response(Buffer.from('terminal clean png bytes'), {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
    });
    const fetch = vi.fn(async () => downloadResponse);
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
      'remove-watermark',
      '--input',
      '/tmp/photo.png',
      '--output',
      outputPath,
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
        tool_name: 'image.gemini_nb_remove_watermark',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_source_123',
        },
      }),
    });
    expect(waitJobCommand).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/files/file_output_123/download',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tgc_cli_secret',
        }),
      }),
    );
    expect(await readFile(outputPath)).toEqual(Buffer.from('terminal clean png bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_watermark_123',
      status: 'succeeded',
      toolName: 'image.gemini_nb_remove_watermark',
      toolVersion: '2026-04-15',
      input: {
        input_file_id: 'file_source_123',
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/png',
          storageKey: 'ws/77/output/job_watermark_123/output.png',
        },
      },
    });
    expect(result.stderr).toBe('');
  });

  it('returns immediately when neither --wait nor --output is set', async () => {
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
          id: 'job_watermark_123',
          status: 'queued',
          toolName: 'image.gemini_nb_remove_watermark',
          toolVersion: '2026-04-15',
        },
      },
      request_id: 'req_create_job_watermark_123',
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
      'remove-watermark',
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
        tool_name: 'image.gemini_nb_remove_watermark',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_source_123',
        },
      }),
    });
    expect(waitJobCommand).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_watermark_123',
      status: 'queued',
      toolName: 'image.gemini_nb_remove_watermark',
      toolVersion: '2026-04-15',
    });
    expect(result.stderr).toBe('');
  });

  it('fails when the downloaded output cannot be retrieved after waiting', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const outputPath = join(tempDir, 'photo-clean.png');

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
      id: 'job_watermark_123',
      status: 'succeeded',
      toolName: 'image.gemini_nb_remove_watermark',
      toolVersion: '2026-04-15',
      input: {
        input_file_id: 'file_source_123',
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/png',
          storageKey: 'ws/77/output/job_watermark_123/output.png',
        },
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_watermark_123',
          status: 'queued',
          toolName: 'image.gemini_nb_remove_watermark',
          toolVersion: '2026-04-15',
        },
      },
      request_id: 'req_create_job_watermark_123',
    }));

    const fetch = vi.fn(async () =>
      new Response('server error', {
        status: 500,
      }),
    );
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
      'remove-watermark',
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
    expect(result.stderr).toContain('Failed to download watermark-removed file file_output_123.');
    expect(waitJobCommand).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
