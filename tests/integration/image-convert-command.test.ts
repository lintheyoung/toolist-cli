import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveEnvironmentBaseUrl } from '../../src/lib/environments.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/image/convert.js');
  vi.doUnmock('../../src/commands/image/convert-input-policy.js');
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

const UNSUPPORTED_TINY_GRAYSCALE_ALPHA_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9mQAAAAASUVORK5CYII=',
  'base64',
);

describe('image convert command', () => {
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
          id: 'job_123',
          status: 'queued',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
        },
      },
      request_id: 'req_create_job_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'convert',
      '--input',
      '/tmp/photo.jpg',
      '--to',
      'webp',
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
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: expect.objectContaining({
        tool_name: 'image.convert_format',
        execution_mode: 'sync',
        input: {
          input_file_id: 'file_source_123',
          target_mime_type: 'image/webp',
          quality: 55,
        },
      }),
    });
    expect(result.stderr).toBe('');
  });

  it('accepts --env and forwards the resolved hosted base URL for image convert', async () => {
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
          id: 'job_123',
          status: 'queued',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
        },
      },
      request_id: 'req_create_job_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'convert',
      '--input',
      '/tmp/photo.jpg',
      '--to',
      'webp',
      '--env',
      'test',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(uploadCommand).toHaveBeenCalledWith({
      input: '/tmp/photo.jpg',
      baseUrl: resolveEnvironmentBaseUrl('test'),
      token: 'tgc_cli_secret',
      configPath: undefined,
    });
    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: resolveEnvironmentBaseUrl('test'),
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/jobs',
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: expect.objectContaining({
        tool_name: 'image.convert_format',
        input: {
          input_file_id: 'file_source_123',
          target_mime_type: 'image/webp',
          quality: 55,
        },
      }),
    });
  });

  it('dispatches image convert through the CLI, waits for completion, downloads the output, and prints the final job payload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const outputPath = join(tempDir, 'photo.webp');

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
      id: 'job_123',
      status: 'succeeded',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
      input: {
        input_file_id: 'file_source_123',
        target_mime_type: 'image/webp',
        quality: 82,
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/webp',
          storageKey: 'ws/77/output/job_123/output.webp',
        },
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_123',
          status: 'queued',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
        },
      },
      request_id: 'req_create_job_123',
    }));

    const downloadResponse = new Response(Buffer.from('webp bytes'), {
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
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'convert',
      '--input',
      '/tmp/photo.jpg',
      '--to',
      'webp',
      '--quality',
      '82',
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
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: expect.objectContaining({
        tool_name: 'image.convert_format',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_source_123',
          target_mime_type: 'image/webp',
          quality: 82,
        },
      }),
    });
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_123',
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
    expect(await readFile(outputPath)).toEqual(Buffer.from('webp bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_123',
      status: 'succeeded',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
      input: {
        input_file_id: 'file_source_123',
        target_mime_type: 'image/webp',
        quality: 82,
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/webp',
          storageKey: 'ws/77/output/job_123/output.webp',
        },
      },
    });
    expect(result.stderr).toBe('');
  });

  it('maps --compress smallest to quality 35 for image convert', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: { 'content-type': 'image/png' },
      filename: 'demo.png',
      mime_type: 'image/png',
      size_bytes: 12,
      file: { fileId: 'file_source_123', status: 'uploaded' },
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_123',
          status: 'queued',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
        },
      },
      request_id: 'req_create_job_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({ uploadCommand }));
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    vi.doMock('../../src/lib/http.js', () => ({ apiRequest }));

    const result = await runCli([
      'image',
      'convert',
      '--input',
      '/tmp/demo.png',
      '--to',
      'webp',
      '--compress',
      'smallest',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        input: {
          input_file_id: 'file_source_123',
          target_mime_type: 'image/webp',
          quality: 35,
        },
      }),
    }));
  });

  it('defaults webp image convert to small compression quality 55', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: { 'content-type': 'image/png' },
      filename: 'demo.png',
      mime_type: 'image/png',
      size_bytes: 12,
      file: { fileId: 'file_source_123', status: 'uploaded' },
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_123',
          status: 'queued',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
        },
      },
      request_id: 'req_create_job_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({ uploadCommand }));
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    vi.doMock('../../src/lib/http.js', () => ({ apiRequest }));

    const result = await runCli([
      'image',
      'convert',
      '--input',
      '/tmp/demo.png',
      '--to',
      'webp',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        input: expect.objectContaining({ quality: 55 }),
      }),
    }));
  });

  it('keeps explicit --quality ahead of --compress for image convert', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_source_123',
      upload_url: 'https://upload.example.com/file_source_123',
      headers: { 'content-type': 'image/png' },
      filename: 'demo.png',
      mime_type: 'image/png',
      size_bytes: 12,
      file: { fileId: 'file_source_123', status: 'uploaded' },
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_123',
          status: 'queued',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
        },
      },
      request_id: 'req_create_job_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({ uploadCommand }));
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    vi.doMock('../../src/lib/http.js', () => ({ apiRequest }));

    const result = await runCli([
      'image',
      'convert',
      '--input',
      '/tmp/demo.png',
      '--to',
      'webp',
      '--quality',
      '60',
      '--compress',
      'smallest',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(apiRequest).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        input: expect.objectContaining({ quality: 60 }),
      }),
    }));
  });

  it('rejects invalid image convert compression presets locally before uploading', async () => {
    const uploadCommand = vi.fn();
    vi.doMock('../../src/commands/files/upload.js', () => ({ uploadCommand }));

    const result = await runCli([
      'image',
      'convert',
      '--input',
      '/tmp/demo.png',
      '--to',
      'webp',
      '--compress',
      'tiny',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Invalid value for --compress.\n');
    expect(uploadCommand).not.toHaveBeenCalled();
  });

  it('skips jobs wait when a sync create response is already terminal', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const outputPath = join(tempDir, 'photo-sync.webp');

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
          id: 'job_sync_123',
          status: 'succeeded',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
          input: {
            input_file_id: 'file_source_123',
            target_mime_type: 'image/webp',
          },
          result: {
            output: {
              outputFileId: 'file_output_123',
              mimeType: 'image/webp',
              storageKey: 'ws/77/output/job_sync_123/output.webp',
            },
          },
        },
      },
      request_id: 'req_create_job_sync_123',
    }));

    const downloadResponse = new Response(Buffer.from('sync webp bytes'), {
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
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    vi.doMock('../../src/commands/jobs/wait.js', () => ({
      waitJobCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'convert',
      '--input',
      '/tmp/photo.jpg',
      '--to',
      'webp',
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
    expect(await readFile(outputPath)).toEqual(Buffer.from('sync webp bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_sync_123',
      status: 'succeeded',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
      input: {
        input_file_id: 'file_source_123',
        target_mime_type: 'image/webp',
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/webp',
          storageKey: 'ws/77/output/job_sync_123/output.webp',
        },
      },
    });
    expect(result.stderr).toBe('');
  });

  it('uses saved credentials when --config-path is provided without --token', async () => {
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
          id: 'job_123',
          status: 'queued',
          toolName: 'image.convert_format',
          toolVersion: '2026-04-12',
        },
      },
      request_id: 'req_create_job_123',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
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
      'convert',
      '--input',
      '/tmp/photo.jpg',
      '--to',
      'webp',
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
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      stage: 'Create job request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: expect.objectContaining({
        tool_name: 'image.convert_format',
        input: {
          input_file_id: 'file_source_123',
          target_mime_type: 'image/webp',
          quality: 55,
        },
      }),
    });
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_123',
      status: 'queued',
      toolName: 'image.convert_format',
      toolVersion: '2026-04-12',
    });
    expect(result.stderr).toBe('');
  });

  it('fails early for the known unsupported tiny grayscale+alpha PNG input', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const inputPath = join(tempDir, 'tiny-ga.png');
    await writeFile(inputPath, UNSUPPORTED_TINY_GRAYSCALE_ALPHA_PNG);

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
      'convert',
      '--input',
      inputPath,
      '--to',
      'webp',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/unsupported/i);
    expect(result.stderr).toMatch(/grayscale\+alpha png/i);
    expect(uploadCommand).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
