import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runBatchItem } from '../../src/lib/batch-item-runner.js';
import type { BatchState } from '../../src/lib/batch-state.js';
import { resolveEnvironmentBaseUrl } from '../../src/lib/environments.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/batch/run.js');
  vi.doUnmock('../../src/lib/batch-manifest.js');
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

function createState(): BatchState {
  return {
    batch_id: 'batch_123',
    manifest_fingerprint: 'manifest_fp_123',
    base_url: 'https://api.example.com',
    created_at: '2026-04-14T00:00:00.000Z',
    items: {},
  };
}

describe('batch run command', () => {
  it('runs a manifest batch and prints aggregated JSON summary', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-batch-cli-'));
    const manifestPath = join(tempDir, 'batch.json');

    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        defaults: {
          wait: true,
          download_outputs: true,
          output_dir: join(tempDir, 'outputs'),
        },
        items: [
          {
            id: 'resize-1',
            tool_name: 'image.resize',
            input_path: '/tmp/photo-a.jpg',
            input: {
              width: 1200,
              target_mime_type: 'image/webp',
            },
          },
          {
            id: 'crop-1',
            tool_name: 'image.crop',
            input_path: '/tmp/photo-b.jpg',
            input: {
              x: 0,
              y: 0,
              width: 400,
              height: 300,
            },
          },
        ],
      }),
      'utf8',
    );

    const runBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: {
        total: 2,
        succeeded: 2,
        failed: 0,
        skipped: 0,
      },
      items: [
        {
          id: 'resize-1',
          status: 'succeeded',
          job_id: 'job_resize_1',
          output_file_id: 'file_output_1',
        },
        {
          id: 'crop-1',
          status: 'succeeded',
          job_id: 'job_crop_1',
          output_file_id: 'file_output_2',
        },
      ],
    }));

    vi.doMock('../../src/commands/batch/run.js', () => ({
      runBatchCommand,
    }));
    vi.doMock('../../src/lib/batch-manifest.js', () => ({
      readBatchManifest: vi.fn(async () => ({
        version: 1,
        defaults: {
          base_url: 'https://api.example.com',
        },
        items: [],
      })),
    }));

    const result = await runCli([
      'batch',
      'run',
      '--manifest',
      manifestPath,
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(runBatchCommand).toHaveBeenCalledWith({
      manifestPath,
      resume: false,
      concurrency: undefined,
      outputDir: undefined,
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      configPath: undefined,
    });

    const output = JSON.parse(result.stdout);

    expect(output.batch_id).toBe('batch_123');
    expect(output.summary.total).toBe(2);
    expect(output.summary.succeeded).toBe(2);
    expect(output.summary.failed).toBe(0);
    expect(output.summary.skipped).toBe(0);
    expect(output.items).toHaveLength(2);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('prefers --env over a manifest defaults.base_url when resolving credentials', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-batch-cli-'));
    const manifestPath = join(tempDir, 'batch.json');

    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        defaults: {
          base_url: 'https://manifest.example.com',
        },
        items: [],
      }),
      'utf8',
    );

    const runBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: {
        total: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      },
      items: [],
    }));

    vi.doMock('../../src/commands/batch/run.js', () => ({
      runBatchCommand,
    }));
    vi.doMock('../../src/lib/batch-manifest.js', () => ({
      readBatchManifest: vi.fn(async () => ({
        version: 1,
        defaults: {
          base_url: 'https://manifest.example.com',
        },
        items: [],
      })),
    }));

    const result = await runCli([
      'batch',
      'run',
      '--manifest',
      manifestPath,
      '--env',
      'test',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(runBatchCommand).toHaveBeenCalledWith({
      manifestPath,
      resume: false,
      concurrency: undefined,
      outputDir: undefined,
      baseUrl: resolveEnvironmentBaseUrl('test'),
      token: 'tgc_cli_secret',
      configPath: undefined,
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it('records partial failures without aborting the whole batch', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-batch-cli-'));
    const manifestPath = join(tempDir, 'batch.json');

    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: 'resize-1',
            tool_name: 'image.resize',
            input_path: '/tmp/photo-a.jpg',
            input: {
              width: 1200,
            },
          },
          {
            id: 'crop-1',
            tool_name: 'image.crop',
            input_path: '/tmp/photo-b.jpg',
            input: {
              x: 0,
              y: 0,
              width: 400,
              height: 300,
            },
          },
        ],
      }),
      'utf8',
    );

    const runBatchItem = vi.fn(async ({ item }: { item: { id: string } }) =>
      item.id === 'crop-1'
        ? {
            id: 'crop-1',
            status: 'failed',
            error: {
              message: 'Insufficient credits to complete crop-1.',
            },
          }
        : {
            id: 'resize-1',
            status: 'succeeded',
            job_id: 'job_resize_1',
            output_file_id: 'file_output_1',
          },
    );

    const readBatchManifest = vi.fn(async () => ({
      version: 1 as const,
      items: [
        {
          id: 'resize-1',
          tool_name: 'image.resize' as const,
          input_path: '/tmp/photo-a.jpg',
          input: {
            width: 1200,
          },
        },
        {
          id: 'crop-1',
          tool_name: 'image.crop' as const,
          input_path: '/tmp/photo-b.jpg',
          input: {
            x: 0,
            y: 0,
            width: 400,
            height: 300,
          },
        },
      ],
    }));

    const runBatchCommand = (await import('../../src/commands/batch/run.js')).runBatchCommand;
    const result = await runBatchCommand(
      {
        manifestPath,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        readBatchManifest,
        runBatchItem,
        loadBatchState: vi.fn(async () => null),
        saveBatchState: vi.fn(async () => undefined),
        getBatchStatePath: vi.fn(() => '/tmp/toollist-batch-state.json'),
        validateResumeState: vi.fn(() => undefined),
        runWithConcurrency: async ({ items, worker }: { items: Array<{ id: string }>; worker: (item: { id: string }) => Promise<unknown> }) =>
          Promise.all(items.map((item) => worker(item))),
      },
    );

    expect(result.summary.total).toBe(2);
    expect(result.summary.succeeded).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.items[1].error?.message).toMatch(/credits/i);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('supports --resume and skips already completed items', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-batch-cli-'));
    const manifestPath = join(tempDir, 'batch.json');

    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        items: [
          {
            id: 'resize-1',
            tool_name: 'image.resize',
            input_path: '/tmp/photo-a.jpg',
            input: {
              width: 1200,
            },
          },
          {
            id: 'crop-1',
            tool_name: 'image.crop',
            input_path: '/tmp/photo-b.jpg',
            input: {
              x: 0,
              y: 0,
              width: 400,
              height: 300,
            },
          },
        ],
      }),
      'utf8',
    );

    const runBatchItem = vi.fn(async ({ item }: { item: { id: string } }) => ({
      id: item.id,
      status: 'succeeded',
      job_id: `job_${item.id}`,
      output_file_id: `file_${item.id}`,
    }));

    const readBatchManifest = vi.fn(async () => ({
      version: 1 as const,
      items: [
        {
          id: 'resize-1',
          tool_name: 'image.resize' as const,
          input_path: '/tmp/photo-a.jpg',
          input: {
            width: 1200,
          },
        },
        {
          id: 'crop-1',
          tool_name: 'image.crop' as const,
          input_path: '/tmp/photo-b.jpg',
          input: {
            x: 0,
            y: 0,
            width: 400,
            height: 300,
          },
        },
      ],
    }));

    const runBatchCommand = (await import('../../src/commands/batch/run.js')).runBatchCommand;
    await runBatchCommand(
      {
        manifestPath,
        resume: true,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      },
      {
        readBatchManifest,
        runBatchItem,
        loadBatchState: vi.fn(async () => ({
          batch_id: 'batch_123',
          manifest_fingerprint: 'fingerprint_123',
          base_url: 'https://api.example.com',
          created_at: '2026-04-14T00:00:00.000Z',
          items: {
            'resize-1': {
              id: 'resize-1',
              status: 'succeeded',
              job_id: 'job_resize-1',
              output_file_id: 'file_resize-1',
            },
            'crop-1': {
              id: 'crop-1',
              status: 'pending',
            },
          },
        })),
        saveBatchState: vi.fn(async () => undefined),
        getBatchStatePath: vi.fn(() => '/tmp/toollist-batch-state.json'),
        validateResumeState: vi.fn(() => undefined),
        runWithConcurrency: async ({ items, worker }: { items: Array<{ id: string }>; worker: (item: { id: string }) => Promise<unknown> }) =>
          Promise.all(items.map((item) => worker(item))),
      },
    );

    expect(runBatchItem).toHaveBeenCalledTimes(1);
    expect(runBatchItem).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({
          id: 'crop-1',
        }),
      }),
    );

    await rm(tempDir, { recursive: true, force: true });
  });
});

describe('batch item runner', () => {
  it('uploads from input_path, creates a job, waits, and returns output ids', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'toollist-batch-output-'));
    const state = createState();

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

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_123',
          status: 'queued',
          toolName: 'image.resize',
          toolVersion: '2026-04-14',
        },
      },
      request_id: 'req_create_job_123',
    }));

    const waitJobCommand = vi.fn(async () => ({
      id: 'job_123',
      status: 'succeeded',
      toolName: 'image.resize',
      toolVersion: '2026-04-14',
      input: {
        input_file_id: 'file_123',
        width: 1200,
        target_mime_type: 'image/webp',
      },
      result: {
        output: {
          outputFileId: 'file_output_123',
          mimeType: 'image/webp',
          storageKey: 'ws/77/output/job_123/output.webp',
        },
      },
    }));

    const fetch = vi.fn(async () => new Response(Buffer.from('webp bytes'), { status: 200 }));
    const writeFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const randomUUID = vi.fn(() => 'uuid_123');
    const saveBatchState = vi.fn(async () => undefined);

    const result = await runBatchItem(
      {
        item: {
          id: 'resize-1',
          tool_name: 'image.resize',
          input_path: '/tmp/photo.jpg',
          input: {
            width: 1200,
            target_mime_type: 'image/webp',
          },
        },
        defaults: {
          wait: true,
          download_outputs: true,
          output_dir: outputDir,
        },
        credentials: {
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        state,
        statePath: '/tmp/batch-state.json',
      },
      {
        apiRequest,
        uploadCommand,
        waitJobCommand,
        fetch,
        writeFile,
        mkdir,
        randomUUID,
        saveBatchState,
      },
    );

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
      body: {
        tool_name: 'image.resize',
        idempotency_key: 'uuid_123',
        input: {
          width: 1200,
          target_mime_type: 'image/webp',
          input_file_id: 'file_123',
        },
      },
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
    expect(mkdir).toHaveBeenCalledWith(outputDir, { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      join(outputDir, basename('ws/77/output/job_123/output.webp')),
      expect.any(Buffer),
    );
    expect(saveBatchState).toHaveBeenCalledTimes(5);
    expect(saveBatchState).toHaveBeenLastCalledWith('/tmp/batch-state.json', state);
    expect(result).toMatchObject({
      id: 'resize-1',
      status: 'succeeded',
      uploaded_file_id: 'file_123',
      job_id: 'job_123',
      output_file_id: 'file_output_123',
      output_path: join(outputDir, 'output.webp'),
    });
    expect(state.items['resize-1']).toMatchObject(result);

    await rm(outputDir, { recursive: true, force: true });
  });

  it('uses input_file_id without uploading again', async () => {
    const state = createState();

    const uploadCommand = vi.fn(async () => {
      throw new Error('upload should not be called');
    });

    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_456',
          status: 'queued',
          toolName: 'image.crop',
          toolVersion: '2026-04-14',
        },
      },
      request_id: 'req_create_job_456',
    }));

    const waitJobCommand = vi.fn(async () => {
      throw new Error('wait should not be called');
    });
    const saveBatchState = vi.fn(async () => undefined);

    const result = await runBatchItem(
      {
        item: {
          id: 'crop-1',
          tool_name: 'image.crop',
          input_file_id: 'file_existing_123',
          input: {
            x: 0,
            y: 0,
            width: 4,
            height: 4,
          },
        },
        defaults: {
          wait: false,
          download_outputs: false,
        },
        credentials: {
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        state,
        statePath: '/tmp/batch-state.json',
      },
      {
        apiRequest,
        uploadCommand,
        waitJobCommand,
        fetch: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        randomUUID: vi.fn(() => 'uuid_456'),
        saveBatchState,
      },
    );

    expect(uploadCommand).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/jobs',
      body: {
        tool_name: 'image.crop',
        idempotency_key: 'uuid_456',
        input: {
          input_file_id: 'file_existing_123',
          x: 0,
          y: 0,
          width: 4,
          height: 4,
        },
      },
    });
    expect(waitJobCommand).not.toHaveBeenCalled();
    expect(saveBatchState).toHaveBeenCalledTimes(3);
    expect(saveBatchState).toHaveBeenLastCalledWith('/tmp/batch-state.json', state);
    expect(result).toMatchObject({
      id: 'crop-1',
      status: 'running',
      job_id: 'job_456',
    });
    expect(result.output_file_id).toBeUndefined();
    expect(result.output_path).toBeUndefined();
    expect(state.items['crop-1']).toMatchObject(result);
  });

  it('reuses uploaded_file_id and job_id from saved state during resume', async () => {
    const state = createState();
    state.items['resume-1'] = {
      id: 'resume-1',
      status: 'running',
      uploaded_file_id: 'file_uploaded_123',
      job_id: 'job_existing_123',
      error: {
        message: 'old failure',
      },
    };

    const uploadCommand = vi.fn(async () => {
      throw new Error('upload should not be called');
    });
    const apiRequest = vi.fn(async () => {
      throw new Error('job creation should not be called');
    });
    const waitJobCommand = vi.fn(async () => ({
      id: 'job_existing_123',
      status: 'succeeded',
      toolName: 'image.resize',
      toolVersion: '2026-04-14',
      input: {
        input_file_id: 'file_uploaded_123',
        width: 1200,
      },
      result: {
        output: {
          outputFileId: 'file_output_456',
          storageKey: 'ws/77/output/job_existing_123/output.webp',
        },
      },
    }));
    const saveBatchState = vi.fn(async () => undefined);

    const result = await runBatchItem(
      {
        item: {
          id: 'resume-1',
          tool_name: 'image.resize',
          input_path: '/tmp/photo.jpg',
          input: {
            width: 1200,
          },
        },
        defaults: {
          wait: true,
          download_outputs: false,
        },
        credentials: {
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        state,
        statePath: '/tmp/batch-state.json',
      },
      {
        apiRequest,
        uploadCommand,
        waitJobCommand,
        fetch: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        randomUUID: vi.fn(() => 'uuid_resume'),
        saveBatchState,
      },
    );

    expect(uploadCommand).not.toHaveBeenCalled();
    expect(apiRequest).not.toHaveBeenCalled();
    expect(waitJobCommand).toHaveBeenCalledWith({
      jobId: 'job_existing_123',
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      timeoutSeconds: 60,
      configPath: undefined,
    });
    expect(result).toMatchObject({
      id: 'resume-1',
      status: 'succeeded',
      uploaded_file_id: 'file_uploaded_123',
      job_id: 'job_existing_123',
      output_file_id: 'file_output_456',
    });
    expect(result.error).toBeUndefined();
    expect(saveBatchState).toHaveBeenCalled();
  });

  it('re-uploads from input_path when only a stale uploaded_file_id exists', async () => {
    const state = createState();
    state.items['resume-upload'] = {
      id: 'resume-upload',
      status: 'failed',
      uploaded_file_id: 'file_stale_123',
      error: {
        message: 'old failure',
      },
    };

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_fresh_456',
      upload_url: 'https://upload.example.com/file_fresh_456',
      headers: {
        'content-type': 'image/jpeg',
      },
      filename: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 12,
      file: {
        fileId: 'file_fresh_456',
        status: 'uploaded',
      },
    }));
    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_new_456',
          status: 'queued',
          toolName: 'image.resize',
          toolVersion: '2026-04-14',
        },
      },
      request_id: 'req_create_job_new_456',
    }));
    const saveBatchState = vi.fn(async () => undefined);

    const result = await runBatchItem(
      {
        item: {
          id: 'resume-upload',
          tool_name: 'image.resize',
          input_path: '/tmp/photo.jpg',
          input: {
            width: 640,
          },
        },
        defaults: {
          wait: false,
          download_outputs: false,
        },
        credentials: {
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        state,
        statePath: '/tmp/batch-state.json',
      },
      {
        apiRequest,
        uploadCommand,
        waitJobCommand: vi.fn(),
        fetch: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        randomUUID: vi.fn(() => 'uuid_fresh'),
        saveBatchState,
      },
    );

    expect(uploadCommand).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      method: 'POST',
      path: '/api/v1/jobs',
      body: {
        tool_name: 'image.resize',
        idempotency_key: 'uuid_fresh',
        input: {
          width: 640,
          input_file_id: 'file_fresh_456',
        },
      },
    });
    expect(result).toMatchObject({
      id: 'resume-upload',
      status: 'running',
      uploaded_file_id: 'file_fresh_456',
      job_id: 'job_new_456',
    });
    expect(result.error).toBeUndefined();
  });

  it('returns an already completed item without clobbering saved output fields', async () => {
    const state = createState();
    state.items['done-1'] = {
      id: 'done-1',
      status: 'succeeded',
      uploaded_file_id: 'file_uploaded_123',
      job_id: 'job_done_123',
      output_file_id: 'file_output_done_123',
      output_path: '/tmp/output.webp',
    };

    const result = await runBatchItem(
      {
        item: {
          id: 'done-1',
          tool_name: 'image.resize',
          input_path: '/tmp/photo.jpg',
          input: {
            width: 320,
          },
        },
        defaults: {
          wait: true,
          download_outputs: true,
        },
        credentials: {
          baseUrl: 'https://api.example.com',
          token: 'tgc_cli_secret',
        },
        state,
        statePath: '/tmp/batch-state.json',
      },
      {
        apiRequest: vi.fn(),
        uploadCommand: vi.fn(),
        waitJobCommand: vi.fn(),
        fetch: vi.fn(),
        writeFile: vi.fn(),
        mkdir: vi.fn(),
        randomUUID: vi.fn(),
        saveBatchState: vi.fn(),
      },
    );

    expect(result).toEqual(state.items['done-1']);
  });
});
