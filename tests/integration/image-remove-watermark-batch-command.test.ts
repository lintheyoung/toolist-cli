import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

describe('image remove-watermark-batch command', () => {
  it('prints dedicated help for remove-watermark-batch', async () => {
    const result = await runCli(['image', 'remove-watermark-batch', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist image remove-watermark-batch');
    expect(result.stdout).toContain('--inputs <path...>');
    expect(result.stdout).toContain('--input-glob <pattern>');
    expect(result.stdout).toContain('--output <path>');
  });

  it('builds a local zip, uploads it, waits for the async job, downloads results.zip, and prints the final payload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-watermark-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    const outputPath = join(tempDir, 'results.zip');

    await writeFile(first, 'first image');
    await writeFile(second, 'second image');

    const uploadCommand = vi.fn(async ({ input }: { input: string }) => ({
      file_id: 'file_batch_source_123',
      upload_url: 'https://upload.example.com/file_batch_source_123',
      headers: {
        'content-type': 'application/zip',
      },
      filename: input.split('/').pop() ?? 'inputs.zip',
      mime_type: 'application/zip',
      size_bytes: 512,
      file: {
        fileId: 'file_batch_source_123',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(
      async (args: { onStatus?: (status: string, job: unknown) => void }) => {
        args.onStatus?.('queued', {
          id: 'job_watermark_batch_123',
          status: 'queued',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
        });
        args.onStatus?.('running', {
          id: 'job_watermark_batch_123',
          status: 'running',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
        });
        args.onStatus?.('succeeded', {
          id: 'job_watermark_batch_123',
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
        });
        return {
          id: 'job_watermark_batch_123',
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
          input: {
            input_file_id: 'file_batch_source_123',
          },
          result: {
            output: {
              filename: 'results.zip',
              outputFileId: 'file_results_123',
              mimeType: 'application/zip',
              storageKey: 'ws/77/output/job_watermark_batch_123/results.zip',
            },
            batch: {
              summary: {
                status: 'completed',
                processedFileCount: 2,
              },
            },
          },
        };
      },
    );

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_watermark_batch_123',
          status: 'queued',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
        },
      },
      request_id: 'req_create_job_watermark_batch_123',
    }));

    const fetch = vi.fn(async () => new Response(Buffer.from('zip output bytes'), { status: 200 }));
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
      'remove-watermark-batch',
      '--inputs',
      first,
      second,
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
    expect(uploadCommand).toHaveBeenCalledTimes(1);
    expect(uploadCommand.mock.calls[0]?.[0]).toEqual({
      input: expect.stringMatching(/inputs\.zip$/),
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
        tool_name: 'image.gemini_nb_remove_watermark_batch',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_batch_source_123',
        },
      }),
    });
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_watermark_batch_123',
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      timeoutSeconds: 60,
      configPath: undefined,
      onStatus: expect.any(Function),
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/files/file_results_123/download',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tgc_cli_secret',
        }),
      }),
    );
    expect(await readFile(outputPath)).toEqual(Buffer.from('zip output bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_watermark_batch_123',
      status: 'succeeded',
      toolName: 'image.gemini_nb_remove_watermark_batch',
      toolVersion: '2026-04-15',
      input: {
        input_file_id: 'file_batch_source_123',
      },
      result: {
        output: {
          filename: 'results.zip',
          outputFileId: 'file_results_123',
          mimeType: 'application/zip',
          storageKey: 'ws/77/output/job_watermark_batch_123/results.zip',
        },
        batch: {
          summary: {
            status: 'completed',
            processedFileCount: 2,
          },
        },
      },
    });
    expect(result.stderr.split('\n').filter(Boolean)).toEqual([
      'Uploading input...',
      'Uploaded file: file_batch_source_123',
      'Creating job...',
      'Created job: job_watermark_batch_123',
      'Waiting for job...',
      'Status: queued',
      'Status: running',
      'Status: succeeded',
      'Downloading output: file_results_123',
      `Saved output: ${outputPath}`,
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('accepts image remove-watermark-batch with --input-glob', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-watermark-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');

    await writeFile(first, 'first image');
    await writeFile(second, 'second image');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_batch_source_456',
      upload_url: 'https://upload.example.com/file_batch_source_456',
      headers: {
        'content-type': 'application/zip',
      },
      filename: 'inputs.zip',
      mime_type: 'application/zip',
      size_bytes: 512,
      file: {
        fileId: 'file_batch_source_456',
        status: 'uploaded',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_watermark_batch_456',
          status: 'queued',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
        },
      },
      request_id: 'req_create_job_watermark_batch_456',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-watermark-batch',
      '--input-glob',
      join(tempDir, '*.jpg'),
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.split('\n').filter(Boolean)).toEqual([
      'Uploading input...',
      'Uploaded file: file_batch_source_456',
      'Creating job...',
      'Created job: job_watermark_batch_456',
    ]);
    expect(uploadCommand).toHaveBeenCalledTimes(1);
    expect(uploadCommand.mock.calls[0]?.[0]).toEqual({
      input: expect.stringMatching(/inputs\.zip$/),
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
        tool_name: 'image.gemini_nb_remove_watermark_batch',
        input: {
          input_file_id: 'file_batch_source_456',
        },
      }),
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns immediately when neither --wait nor --output is set', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-watermark-batch-'));
    const first = join(tempDir, 'a.jpg');

    await writeFile(first, 'first image');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_batch_source_nowait',
      upload_url: 'https://upload.example.com/file_batch_source_nowait',
      headers: {
        'content-type': 'application/zip',
      },
      filename: 'inputs.zip',
      mime_type: 'application/zip',
      size_bytes: 512,
      file: {
        fileId: 'file_batch_source_nowait',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(async () => {
      throw new Error('wait should not be called');
    });

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_watermark_batch_nowait',
          status: 'queued',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
        },
      },
      request_id: 'req_create_job_watermark_batch_nowait',
    }));

    const fetch = vi.fn(async () => {
      throw new Error('download should not be called');
    });
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
      'remove-watermark-batch',
      '--inputs',
      first,
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(waitJobCommand).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_watermark_batch_nowait',
      status: 'queued',
      toolName: 'image.gemini_nb_remove_watermark_batch',
      toolVersion: '2026-04-15',
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses application/zip when uploading a real generated batch archive', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-watermark-batch-upload-'));
    const first = join(tempDir, 'a.jpg');
    const outputDir = join(tempDir, 'zipped');

    await writeFile(first, 'first image');

    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);

    const apiRequest = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          file_id: 'file_zip_123',
          upload_url: 'https://upload.example.com/file_zip_123',
          headers: {
            'x-upload-token': 'abc123',
          },
        },
        request_id: 'req_create_upload_zip_123',
      })
      .mockResolvedValueOnce({
        data: {
          file: {
            fileId: 'file_zip_123',
            status: 'uploaded',
          },
        },
        request_id: 'req_complete_upload_zip_123',
      });

    const { createZipBatchInput } = await import('../../src/lib/zip-batch-input.js');
    const { uploadCommand } = await import('../../src/commands/files/upload.js');

    const zipInput = await createZipBatchInput({
      inputs: [first],
      outputDir,
    });

    const result = await uploadCommand(
      {
        input: zipInput.zipPath,
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
      body: {
        filename: 'inputs.zip',
        mime_type: 'application/zip',
        size_bytes: expect.any(Number),
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://upload.example.com/file_zip_123',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'content-type': 'application/zip',
        }),
      }),
    );
    expect(result.mime_type).toBe('application/zip');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('fails when --env is missing a value', async () => {
    const result = await runCli([
      'image',
      'remove-watermark-batch',
      '--inputs',
      './a.jpg',
      '--env',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing value for option: --env');
  });

  it('only cleans up temp directories it created itself', async () => {
    const waitJobCommand = vi.fn(async () => ({
      id: 'job_watermark_batch_cleanup',
      status: 'queued',
      toolName: 'image.gemini_nb_remove_watermark_batch',
      toolVersion: '2026-04-15',
    }));
    const rmMock = vi.fn(async () => undefined);

    const { imageRemoveWatermarkBatchCommand } = await import(
      '../../src/commands/image/remove-watermark-batch.js'
    );

    await imageRemoveWatermarkBatchCommand(
      {
        inputs: ['/tmp/a.jpg'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        createZipBatchInput: vi
          .fn()
          .mockResolvedValueOnce({
            zipPath: '/tmp/caller-owned/inputs.zip',
            inputCount: 1,
          })
          .mockResolvedValueOnce({
            zipPath: '/tmp/tool-owned/inputs.zip',
            inputCount: 1,
            cleanupPath: '/tmp/tool-owned',
          }),
        uploadCommand: vi.fn(async () => ({
          file_id: 'file_batch_cleanup',
        })),
        apiRequest: vi.fn(async () => ({
          data: {
            job: {
              id: 'job_watermark_batch_cleanup',
              status: 'queued',
              toolName: 'image.gemini_nb_remove_watermark_batch',
              toolVersion: '2026-04-15',
            },
          },
          request_id: 'req_job_cleanup',
        })),
        waitJobCommand,
        rm: rmMock,
      },
    );

    await imageRemoveWatermarkBatchCommand(
      {
        inputs: ['/tmp/a.jpg'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        createZipBatchInput: vi.fn(async () => ({
          zipPath: '/tmp/tool-owned/inputs.zip',
          inputCount: 1,
          cleanupPath: '/tmp/tool-owned',
        })),
        uploadCommand: vi.fn(async () => ({
          file_id: 'file_batch_cleanup',
        })),
        apiRequest: vi.fn(async () => ({
          data: {
            job: {
              id: 'job_watermark_batch_cleanup',
              status: 'queued',
              toolName: 'image.gemini_nb_remove_watermark_batch',
              toolVersion: '2026-04-15',
            },
          },
          request_id: 'req_job_cleanup',
        })),
        waitJobCommand,
        rm: rmMock,
      },
    );

    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith('/tmp/tool-owned', {
      recursive: true,
      force: true,
    });
  });
});
