import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
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

describe('image crop command', () => {
  it('forwards execution_mode sync when --sync is provided', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: {
        'content-type': 'image/jpeg',
      },
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 12,
      file: {
        fileId: 'file_source_123',
        status: 'uploaded',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_crop_123',
          status: 'queued',
          toolName: 'image.crop',
          toolVersion: '2026-04-13',
        },
      },
      request_id: 'req_create_job_crop_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'crop',
      '--input',
      '/tmp/photo.jpg',
      '--x',
      '10',
      '--y',
      '20',
      '--width',
      '320',
      '--height',
      '240',
      '--sync',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/jobs',
      body: expect.objectContaining({
        tool_name: 'image.crop',
        execution_mode: 'sync',
        input: {
          input_file_id: 'file_source_123',
          x: 10,
          y: 20,
          width: 320,
          height: 240,
        },
      }),
    });
    expect(result.stderr).toBe('');
  });

  it('dispatches image crop through the CLI, waits for completion, downloads the output, and prints the final job payload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const outputPath = join(tempDir, 'photo-cropped.png');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: {
        'content-type': 'image/jpeg',
      },
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 12,
      file: {
        fileId: 'file_source_123',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(async () => ({
      id: 'job_crop_123',
      status: 'succeeded',
      toolName: 'image.crop',
      toolVersion: '2026-04-13',
      input: {
        input_file_id: 'file_source_123',
        x: 10,
        y: 20,
        width: 320,
        height: 240,
        target_mime_type: 'image/png',
        quality: 90,
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/png',
          storageKey: 'ws/77/output/job_crop_123/output.png',
        },
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_crop_123',
          status: 'queued',
          toolName: 'image.crop',
          toolVersion: '2026-04-13',
        },
      },
      request_id: 'req_create_job_crop_123',
    }));

    const downloadResponse = new Response(Buffer.from('cropped png bytes'), {
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
      'crop',
      '--input',
      '/tmp/photo.jpg',
      '--x',
      '10',
      '--y',
      '20',
      '--width',
      '320',
      '--height',
      '240',
      '--to',
      'png',
      '--quality',
      '90',
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
      input: '/tmp/photo.jpg',
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
        tool_name: 'image.crop',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_source_123',
          x: 10,
          y: 20,
          width: 320,
          height: 240,
          target_mime_type: 'image/png',
          quality: 90,
        },
      }),
    });
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_crop_123',
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
    expect(await readFile(outputPath)).toEqual(Buffer.from('cropped png bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_crop_123',
      status: 'succeeded',
      toolName: 'image.crop',
      toolVersion: '2026-04-13',
      input: {
        input_file_id: 'file_source_123',
        x: 10,
        y: 20,
        width: 320,
        height: 240,
        target_mime_type: 'image/png',
        quality: 90,
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/png',
          storageKey: 'ws/77/output/job_crop_123/output.png',
        },
      },
    });
    expect(result.stderr).toBe('');
  });

  it('skips jobs wait when a sync crop create response is already terminal', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const outputPath = join(tempDir, 'photo-sync-cropped.webp');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: {
        'content-type': 'image/jpeg',
      },
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
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
          id: 'job_crop_sync_123',
          status: 'succeeded',
          toolName: 'image.crop',
          toolVersion: '2026-04-13',
          input: {
            input_file_id: 'file_source_123',
            x: 10,
            y: 20,
            width: 320,
            height: 240,
          },
          result: {
            output: {
              outputFileId: 'file_output_123',
              mimeType: 'image/webp',
              storageKey: 'ws/77/output/job_crop_sync_123/output.webp',
            },
          },
        },
      },
      request_id: 'req_create_job_crop_sync_123',
    }));

    const downloadResponse = new Response(Buffer.from('sync cropped webp bytes'), {
      status: 200,
      headers: {
        'content-type': 'image/webp',
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
      'crop',
      '--input',
      '/tmp/photo.jpg',
      '--x',
      '10',
      '--y',
      '20',
      '--width',
      '320',
      '--height',
      '240',
      '--sync',
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
    expect(waitJobCommand).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/files/file_output_123/download',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tgc_cli_secret',
        }),
      }),
    );
    expect(await readFile(outputPath)).toEqual(Buffer.from('sync cropped webp bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_crop_sync_123',
      status: 'succeeded',
      toolName: 'image.crop',
      toolVersion: '2026-04-13',
      input: {
        input_file_id: 'file_source_123',
        x: 10,
        y: 20,
        width: 320,
        height: 240,
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/webp',
          storageKey: 'ws/77/output/job_crop_sync_123/output.webp',
        },
      },
    });
    expect(result.stderr).toBe('');
  });

  it('uses saved credentials for image crop when --config-path is provided without --token', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: {
        'content-type': 'image/jpeg',
      },
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 12,
      file: {
        fileId: 'file_source_123',
        status: 'uploaded',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_crop_123',
          status: 'queued',
          toolName: 'image.crop',
          toolVersion: '2026-04-13',
        },
      },
      request_id: 'req_create_job_crop_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/lib/http.js')>();
      return {
        ...actual,
        apiRequest,
      };
    });
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
      'image',
      'crop',
      '--input',
      '/tmp/photo.jpg',
      '--x',
      '10',
      '--y',
      '20',
      '--width',
      '320',
      '--height',
      '240',
      '--config-path',
      '/tmp/toollist-config.json',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(uploadCommand).toHaveBeenCalledWith({
      input: '/tmp/photo.jpg',
      baseUrl: 'https://saved.example.com',
      token: 'saved_token_123',
      configPath: '/tmp/toollist-config.json',
    });
    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://saved.example.com',
      token: 'saved_token_123',
      method: 'POST',
      path: '/api/v1/jobs',
      body: expect.objectContaining({
        tool_name: 'image.crop',
        input: {
          input_file_id: 'file_source_123',
          x: 10,
          y: 20,
          width: 320,
          height: 240,
        },
      }),
    });
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_crop_123',
      status: 'queued',
      toolName: 'image.crop',
      toolVersion: '2026-04-13',
    });
    expect(result.stderr).toBe('');
  });

  it('rejects invalid crop coordinates and dimensions locally before uploading', async () => {
    const uploadCommand = vi.fn();
    const apiRequest = vi.fn();

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'crop',
      '--input',
      '/tmp/photo.jpg',
      '--x',
      '-1',
      '--y',
      '20',
      '--width',
      '320',
      '--height',
      '240',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Invalid value for --x.\n');
    expect(uploadCommand).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid crop quality locally before uploading', async () => {
    const uploadCommand = vi.fn();
    const apiRequest = vi.fn();

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'crop',
      '--input',
      '/tmp/photo.jpg',
      '--x',
      '10',
      '--y',
      '20',
      '--width',
      '320',
      '--height',
      '240',
      '--quality',
      '0',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('Invalid value for --quality.\n');
    expect(uploadCommand).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
