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

describe('document docx-to-markdown command', () => {
  it('prints document command help', async () => {
    const result = await runCli(['document', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist document');
    expect(result.stdout).toContain('docx-to-markdown');
    expect(result.stdout).toContain('docx-to-markdown-batch');
  });

  it('prints dedicated help for docx-to-markdown-batch', async () => {
    const result = await runCli(['document', 'docx-to-markdown-batch', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist document docx-to-markdown-batch');
    expect(result.stdout).toContain('--inputs <path...>');
    expect(result.stdout).toContain('--input-glob <pattern>');
    expect(result.stdout).toContain('--output <path>');
  });

  it('uploads a DOCX, creates the async conversion job, waits, downloads the bundle, and prints the final job payload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-docx-command-'));
    const outputPath = join(tempDir, 'bundle.zip');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_docx_source_123',
      upload_url: 'https://upload.example.com/file_docx_source_123',
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      filename: 'document.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: 12,
      file: {
        fileId: 'file_docx_source_123',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(async () => ({
      id: 'job_docx_123',
      status: 'succeeded',
      toolName: 'document.docx_to_markdown_bundle',
      toolVersion: '2026-04-19',
      input: {
        input_file_id: 'file_docx_source_123',
      },
      result: {
        output: {
          filename: 'bundle.zip',
          outputFileId: 'file_docx_output_123',
          mimeType: 'application/zip',
          storageKey: 'ws/77/output/job_docx_123/bundle.zip',
        },
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_docx_123',
          status: 'queued',
          toolName: 'document.docx_to_markdown_bundle',
          toolVersion: '2026-04-19',
        },
      },
      request_id: 'req_create_job_docx_123',
    }));

    const fetch = vi.fn(async () => new Response(Buffer.from('bundle bytes'), { status: 200 }));
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
      'document',
      'docx-to-markdown',
      '--input',
      '/tmp/document.docx',
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
      input: '/tmp/document.docx',
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
        tool_name: 'document.docx_to_markdown_bundle',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_docx_source_123',
        },
      }),
    });
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_docx_123',
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      timeoutSeconds: 60,
      configPath: undefined,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/files/file_docx_output_123/download',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tgc_cli_secret',
        }),
      }),
    );
    expect(await readFile(outputPath)).toEqual(Buffer.from('bundle bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_docx_123',
      status: 'succeeded',
      toolName: 'document.docx_to_markdown_bundle',
      toolVersion: '2026-04-19',
      input: {
        input_file_id: 'file_docx_source_123',
      },
      result: {
        output: {
          filename: 'bundle.zip',
          outputFileId: 'file_docx_output_123',
          mimeType: 'application/zip',
          storageKey: 'ws/77/output/job_docx_123/bundle.zip',
        },
      },
    });
    expect(result.stderr).toBe('');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('prints backend job failure details before checking the DOCX output bundle', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-docx-command-'));
    const outputPath = join(tempDir, 'bundle.zip');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_docx_source_123',
      upload_url: 'https://upload.example.com/file_docx_source_123',
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      filename: 'document.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: 12,
      file: {
        fileId: 'file_docx_source_123',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(async () => ({
      id: 'job_docx_failed_402',
      status: 'failed',
      toolName: 'document.docx_to_markdown_bundle',
      toolVersion: '2026-04-19',
      errorCode: 'PROVIDER_REQUEST_FAILED',
      errorMessage: 'Replicate request failed with status 402',
      progress: {
        externalTaskId: 'replicate_prediction_docx_123',
        providerStatus: 'failed',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_docx_failed_402',
          status: 'queued',
          toolName: 'document.docx_to_markdown_bundle',
          toolVersion: '2026-04-19',
        },
      },
      request_id: 'req_create_job_docx_failed_402',
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
      'document',
      'docx-to-markdown',
      '--input',
      '/tmp/document.docx',
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
    expect(result.stderr).toContain('Job failed: job_docx_failed_402');
    expect(result.stderr).toContain('Status: failed');
    expect(result.stderr).toContain('Error code: PROVIDER_REQUEST_FAILED');
    expect(result.stderr).toContain('Error message: Replicate request failed with status 402');
    expect(result.stderr).toContain('External task id: replicate_prediction_docx_123');
    expect(result.stderr).toContain('Provider status: failed');
    expect(result.stderr).not.toContain('did not produce an output file');
    expect(fetch).not.toHaveBeenCalled();

    await rm(tempDir, { recursive: true, force: true });
  });

  it('routes --env test to the hosted test base URL', async () => {
    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_docx_source_test',
      file: {
        fileId: 'file_docx_source_test',
        status: 'uploaded',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_docx_test',
          status: 'queued',
          toolName: 'document.docx_to_markdown_bundle',
          toolVersion: '2026-04-19',
        },
      },
      request_id: 'req_create_job_docx_test',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'document',
      'docx-to-markdown',
      '--input',
      '/tmp/document.docx',
      '--env',
      'test',
      '--token',
      'tgc_cli_secret',
      '--config-path',
      '/tmp/toollist-cli-empty-config.json',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(uploadCommand).toHaveBeenCalledWith({
      input: '/tmp/document.docx',
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_cli_secret',
      configPath: '/tmp/toollist-cli-empty-config.json',
    });
    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://test.tooli.st',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/jobs',
      body: expect.objectContaining({
        tool_name: 'document.docx_to_markdown_bundle',
      }),
    });
  });

  it('builds a local DOCX zip batch, uploads it, waits, downloads the batch bundle, and prints the final payload', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-docx-batch-'));
    const first = join(tempDir, 'a.docx');
    const second = join(tempDir, 'b.docx');
    const outputPath = join(tempDir, 'results.zip');

    await writeFile(first, 'first docx');
    await writeFile(second, 'second docx');

    const uploadCommand = vi.fn(async ({ input }: { input: string }) => ({
      file_id: 'file_docx_batch_source_123',
      filename: input.split('/').pop() ?? 'inputs.zip',
      mime_type: 'application/zip',
      file: {
        fileId: 'file_docx_batch_source_123',
        status: 'uploaded',
      },
    }));

    const waitJobCommand = vi.fn(async () => ({
      id: 'job_docx_batch_123',
      status: 'succeeded',
      toolName: 'document.docx_to_markdown_bundle_batch',
      toolVersion: '2026-04-19',
      input: {
        input_file_id: 'file_docx_batch_source_123',
      },
      result: {
        output: {
          filename: 'results.zip',
          outputFileId: 'file_docx_batch_output_123',
          mimeType: 'application/zip',
          storageKey: 'ws/77/output/job_docx_batch_123/results.zip',
        },
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_docx_batch_123',
          status: 'queued',
          toolName: 'document.docx_to_markdown_bundle_batch',
          toolVersion: '2026-04-19',
        },
      },
      request_id: 'req_create_job_docx_batch_123',
    }));

    const fetch = vi.fn(async () => new Response(Buffer.from('batch bundle bytes'), { status: 200 }));
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
      'document',
      'docx-to-markdown-batch',
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
        tool_name: 'document.docx_to_markdown_bundle_batch',
        idempotency_key: expect.any(String),
        input: {
          input_file_id: 'file_docx_batch_source_123',
        },
      }),
    });
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_docx_batch_123',
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      timeoutSeconds: 60,
      configPath: undefined,
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/files/file_docx_batch_output_123/download',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer tgc_cli_secret',
        }),
      }),
    );
    expect(await readFile(outputPath)).toEqual(Buffer.from('batch bundle bytes'));
    expect(JSON.parse(result.stdout)).toEqual({
      id: 'job_docx_batch_123',
      status: 'succeeded',
      toolName: 'document.docx_to_markdown_bundle_batch',
      toolVersion: '2026-04-19',
      input: {
        input_file_id: 'file_docx_batch_source_123',
      },
      result: {
        output: {
          filename: 'results.zip',
          outputFileId: 'file_docx_batch_output_123',
          mimeType: 'application/zip',
          storageKey: 'ws/77/output/job_docx_batch_123/results.zip',
        },
      },
    });
    expect(result.stderr).toBe('');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('accepts docx-to-markdown-batch with --input-glob', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-docx-batch-glob-'));
    const first = join(tempDir, 'a.docx');
    const second = join(tempDir, 'b.docx');

    await writeFile(first, 'first docx');
    await writeFile(second, 'second docx');

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_docx_batch_source_glob',
      file: {
        fileId: 'file_docx_batch_source_glob',
        status: 'uploaded',
      },
    }));

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_docx_batch_glob',
          status: 'queued',
          toolName: 'document.docx_to_markdown_bundle_batch',
          toolVersion: '2026-04-19',
        },
      },
      request_id: 'req_create_job_docx_batch_glob',
    }));

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'document',
      'docx-to-markdown-batch',
      '--input-glob',
      join(tempDir, '*.docx'),
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
        tool_name: 'document.docx_to_markdown_bundle_batch',
        input: {
          input_file_id: 'file_docx_batch_source_glob',
        },
      }),
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it('only cleans up document batch temp directories it created itself', async () => {
    const rmMock = vi.fn(async () => undefined);

    const { documentDocxToMarkdownBatchCommand } = await import(
      '../../src/commands/document/docx-to-markdown-batch.js'
    );

    await documentDocxToMarkdownBatchCommand(
      {
        inputs: ['/tmp/a.docx'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        createZipBatchInput: vi.fn(async () => ({
          zipPath: '/tmp/caller-owned/inputs.zip',
          inputCount: 1,
        })),
        uploadCommand: vi.fn(async () => ({
          file_id: 'file_docx_batch_cleanup',
        })),
        apiRequest: vi.fn(async () => ({
          data: {
            job: {
              id: 'job_docx_batch_cleanup',
              status: 'queued',
              toolName: 'document.docx_to_markdown_bundle_batch',
              toolVersion: '2026-04-19',
            },
          },
          request_id: 'req_docx_batch_cleanup',
        })),
        waitJobCommand: vi.fn(),
        rm: rmMock,
      },
    );

    await documentDocxToMarkdownBatchCommand(
      {
        inputs: ['/tmp/a.docx'],
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
          file_id: 'file_docx_batch_cleanup',
        })),
        apiRequest: vi.fn(async () => ({
          data: {
            job: {
              id: 'job_docx_batch_cleanup',
              status: 'queued',
              toolName: 'document.docx_to_markdown_bundle_batch',
              toolVersion: '2026-04-19',
            },
          },
          request_id: 'req_docx_batch_cleanup',
        })),
        waitJobCommand: vi.fn(),
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
