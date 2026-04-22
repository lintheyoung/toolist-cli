import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function mockRetrySleepsImmediate() {
  return vi.spyOn(globalThis, 'setTimeout').mockImplementation(
    ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => {
      callback(...args);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
  );
}

function mockFileReadDependencies(fileContents: Buffer) {
  return {
    readFile: async () => fileContents,
    stat: async () => ({ size: fileContents.length }) as any,
  };
}

describe('files upload command', () => {
  it('dispatches files upload through the CLI and prints the JSON result', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_123',
      upload_url: 'https://upload.example.com/file_123',
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
    });
    expect(JSON.parse(result.stdout)).toEqual({
      file_id: 'file_123',
      upload_url: 'https://upload.example.com/file_123',
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

  it('defaults files upload to the hosted Toolist base URL when --base-url is omitted', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_123',
      upload_url: 'https://upload.example.com/file_123',
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
      '--config-path',
      '/tmp/toollist-cli-empty-config.json',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(uploadCommand).toHaveBeenCalledWith({
      input: '/tmp/photo.jpg',
      baseUrl: 'https://tooli.st',
      token: 'tgc_cli_secret',
      configPath: '/tmp/toollist-cli-empty-config.json',
      computeSha256: false,
    });
  });

  it('infers file metadata, uploads bytes, and completes the file upload without sha256 by default', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
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
      },
      {
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenNthCalledWith(1, {
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/files/create-upload',
      stage: 'Create upload request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: {
        filename: 'photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: fileContents.length,
      },
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://upload.example.com/file_123',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'content-type': 'image/jpeg',
        }),
        body: fileContents,
      }),
    );

    expect(apiRequest).toHaveBeenNthCalledWith(2, {
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/files/file_123/complete',
      stage: 'Complete upload request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: undefined,
    });

    expect(result).toEqual({
      file_id: 'file_123',
      upload_url: 'https://upload.example.com/file_123',
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

  it('retries complete upload request transport failures and returns the file upload result', async () => {
    const fileContents = Buffer.from('hello world');
    const setTimeoutSpy = mockRetrySleepsImmediate();

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            file_id: 'file_123',
            upload_url: 'https://upload.example.com/file_123',
            headers: {
              'content-type': 'image/jpeg',
            },
          },
          request_id: 'req_create_upload_123',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            file: {
              fileId: 'file_123',
              status: 'uploaded',
            },
          },
          request_id: 'req_complete_upload_123',
        }),
      );
    vi.stubGlobal('fetch', fetch);

    const { uploadCommand } = await import('../../src/commands/files/upload.js');

    const result = await uploadCommand(
      {
        input: '/tmp/photo.jpg',
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      mockFileReadDependencies(fileContents),
    );

    expect(result.file).toEqual({
      fileId: 'file_123',
      status: 'uploaded',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      'https://api.example.com/api/v1/files/file_123/complete',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('keeps complete upload stage context when transport failures exceed retry budget', async () => {
    const fileContents = Buffer.from('hello world');
    const setTimeoutSpy = mockRetrySleepsImmediate();

    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            file_id: 'file_123',
            upload_url: 'https://upload.example.com/file_123',
            headers: {
              'content-type': 'image/jpeg',
            },
          },
          request_id: 'req_create_upload_123',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);

    const { uploadCommand } = await import('../../src/commands/files/upload.js');

    await expect(
      uploadCommand(
        {
          input: '/tmp/photo.jpg',
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        mockFileReadDependencies(fileContents),
      ),
    ).rejects.toThrow('Complete upload request failed: fetch failed');

    expect(fetch).toHaveBeenCalledTimes(5);
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 1000);
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 3000);
  });

  it('retries create upload request transport failures and returns the file upload result', async () => {
    const fileContents = Buffer.from('hello world');
    const setTimeoutSpy = mockRetrySleepsImmediate();

    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            file_id: 'file_123',
            upload_url: 'https://upload.example.com/file_123',
            headers: {
              'content-type': 'image/jpeg',
            },
          },
          request_id: 'req_create_upload_123',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            file: {
              fileId: 'file_123',
              status: 'uploaded',
            },
          },
          request_id: 'req_complete_upload_123',
        }),
      );
    vi.stubGlobal('fetch', fetch);

    const { uploadCommand } = await import('../../src/commands/files/upload.js');

    const result = await uploadCommand(
      {
        input: '/tmp/photo.jpg',
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      mockFileReadDependencies(fileContents),
    );

    expect(result.file).toEqual({
      fileId: 'file_123',
      status: 'uploaded',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/v1/files/create-upload',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/api/v1/files/create-upload',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });

  it('keeps create upload stage context when transport failures exceed retry budget', async () => {
    const fileContents = Buffer.from('hello world');
    const setTimeoutSpy = mockRetrySleepsImmediate();

    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);

    const { uploadCommand } = await import('../../src/commands/files/upload.js');

    await expect(
      uploadCommand(
        {
          input: '/tmp/photo.jpg',
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        mockFileReadDependencies(fileContents),
      ),
    ).rejects.toThrow('Create upload request failed: fetch failed');

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), 1000);
    expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), 3000);
  });

  it('infers the DOCX mime type for document uploads', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const inputPath = join(tempDir, 'document.docx');
    const fileContents = Buffer.from('docx bytes');
    await writeFile(inputPath, fileContents);

    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    const apiRequest = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          file_id: 'file_docx_123',
          upload_url: 'https://upload.example.com/file_docx_123',
          headers: {
            'x-upload-token': 'abc123',
          },
        },
        request_id: 'req_create_upload_docx_123',
      })
      .mockResolvedValueOnce({
        data: {
          file: {
            fileId: 'file_docx_123',
            status: 'uploaded',
          },
        },
        request_id: 'req_complete_upload_docx_123',
      });

    const { uploadCommand } = await import('../../src/commands/files/upload.js');

    const result = await uploadCommand(
      {
        input: inputPath,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenNthCalledWith(1, {
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/files/create-upload',
      stage: 'Create upload request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: {
        filename: 'document.docx',
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size_bytes: fileContents.length,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://upload.example.com/file_docx_123',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        body: fileContents,
      }),
    );
    expect(result.mime_type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('computes sha256 only when the upload command is asked to', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
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

    await uploadCommand(
      {
        input: inputPath,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        computeSha256: true,
      },
      {
        apiRequest,
      },
    );

    expect(apiRequest).toHaveBeenNthCalledWith(2, {
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/files/file_123/complete',
      stage: 'Complete upload request failed',
      retry: {
        attempts: 3,
        delaysMs: [1000, 3000],
      },
      body: {
        sha256: createHash('sha256').update(fileContents).digest('hex'),
      },
    });
  });

  it('adds upload stage context to presigned PUT transport failures', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-cli-'));
    const inputPath = join(tempDir, 'photo.jpg');
    const fileContents = Buffer.from('hello world');
    await writeFile(inputPath, fileContents);

    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetch);

    const apiRequest = vi.fn(async () => ({
      data: {
        file_id: 'file_123',
        upload_url: 'https://upload.example.com/file_123',
        headers: {
          'content-type': 'image/jpeg',
        },
      },
      request_id: 'req_create_upload_123',
    }));

    const { uploadCommand } = await import('../../src/commands/files/upload.js');

    await expect(
      uploadCommand(
        {
          input: inputPath,
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        {
          apiRequest,
        },
      ),
    ).rejects.toThrow('Upload request failed: fetch failed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
