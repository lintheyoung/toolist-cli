import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/image/convert.js');
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

describe('image convert command', () => {
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
});
