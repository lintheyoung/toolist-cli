import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/files/upload.js');
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

describe('public files upload command', () => {
  it('passes --public through the CLI and preserves public_url in the JSON output', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_123',
      upload_url: 'https://upload.example.com/file_123',
      public_url: 'https://cdn.example.com/file_123.jpg',
      headers: {
        'content-type': 'image/jpeg',
      },
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 12,
      file: {
        fileId: 'file_123',
        status: 'uploaded',
      },
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));

    const result = await runCli([
      'files',
      'upload',
      '--input',
      '/tmp/photo.jpg',
      '--public',
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
      computeSha256: false,
      public: true,
    });
    expect(JSON.parse(result.stdout)).toEqual({
      file_id: 'file_123',
      upload_url: 'https://upload.example.com/file_123',
      public_url: 'https://cdn.example.com/file_123.jpg',
      headers: {
        'content-type': 'image/jpeg',
      },
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 12,
      file: {
        fileId: 'file_123',
        status: 'uploaded',
      },
    });
    expect(result.stderr).toBe('');
  });

  it('sends public uploads to the create-upload API and returns the public_url', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-public-'));
    const inputPath = join(tempDir, 'photo.jpg');
    const fileContents = Buffer.from('hello world');
    await writeFile(inputPath, fileContents);

    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    const apiRequest = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          file_id: 'file_123',
          upload_url: 'https://upload.example.com/file_123',
          public_url: 'https://cdn.example.com/file_123.jpg',
          headers: {
            'content-type': 'image/jpeg',
          },
        },
        request_id: 'req_create_upload_123',
      })
      .mockResolvedValueOnce({
        data: {
          file: {
            fileId: 'file_123',
            status: 'uploaded',
          },
        },
        request_id: 'req_complete_upload_123',
      });

    const { uploadCommand } = await import('../../src/commands/files/upload.js');

    const result = await uploadCommand(
      {
        input: inputPath,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        public: true,
      } as any,
      {
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenNthCalledWith(1, {
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/files/create-upload',
      body: {
        filename: 'photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: fileContents.length,
        public: true,
      },
    });

    expect(result).toEqual({
      file_id: 'file_123',
      upload_url: 'https://upload.example.com/file_123',
      public_url: 'https://cdn.example.com/file_123.jpg',
      headers: {
        'content-type': 'image/jpeg',
      },
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: fileContents.length,
      file: {
        fileId: 'file_123',
        status: 'uploaded',
      },
    });
  });
});
