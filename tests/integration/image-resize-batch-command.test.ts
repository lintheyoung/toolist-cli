import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('image resize-batch wrapper', () => {
  it('builds a resize manifest from explicit input paths', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-resize-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    await writeFile(first, 'a');
    await writeFile(second, 'b');

    const { buildResizeBatchManifest } = await import(
      '../../src/commands/image/resize-batch.js'
    );

    const manifest = await buildResizeBatchManifest({
      inputs: [first, second],
      width: 1200,
      to: 'webp',
      quality: 35,
    });

    expect(manifest.items).toHaveLength(2);
    expect(manifest.items[0]).toMatchObject({
      id: 'resize-001',
      tool_name: 'image.resize',
      input_path: first,
      input: {
        width: 1200,
        target_mime_type: 'image/webp',
        quality: 35,
      },
    });
    expect(manifest.items[1]).toMatchObject({
      id: 'resize-002',
      input_path: second,
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it('builds a resize manifest from glob-expanded paths', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-resize-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    const third = join(tempDir, 'c.jpg');
    await writeFile(first, 'a');
    await writeFile(second, 'b');
    await writeFile(third, 'c');

    const { buildResizeBatchManifest } = await import(
      '../../src/commands/image/resize-batch.js'
    );

    const manifest = await buildResizeBatchManifest({
      inputGlob: join(tempDir, '*.jpg'),
      width: 640,
    });

    expect(manifest.items).toHaveLength(3);
    expect(manifest.items.map((item) => item.input_path)).toEqual([
      first,
      second,
      third,
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('de-duplicates overlapping inputs from --inputs and --input-glob', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-resize-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    await writeFile(first, 'a');
    await writeFile(second, 'b');

    const { buildResizeBatchManifest } = await import(
      '../../src/commands/image/resize-batch.js'
    );

    const manifest = await buildResizeBatchManifest({
      inputs: [first],
      inputGlob: join(tempDir, '*.jpg'),
      width: 640,
    });

    expect(manifest.items.map((item) => item.input_path)).toEqual([first, second]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('delegates synthesized manifest and credentials into runBatchCommand', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-resize-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    await writeFile(first, 'a');
    await writeFile(second, 'b');

    const runBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: {
        total: 2,
        succeeded: 2,
        failed: 0,
        skipped: 0,
      },
      items: [
        { id: 'resize-001', status: 'succeeded' },
        { id: 'resize-002', status: 'succeeded' },
      ],
    }));

    const { imageResizeBatchCommand } = await import(
      '../../src/commands/image/resize-batch.js'
    );

    const result = await imageResizeBatchCommand(
      {
        inputs: [first, second],
        width: 1200,
        to: 'webp',
        quality: 35,
        concurrency: 2,
        wait: true,
        outputDir: join(tempDir, 'outputs'),
        resume: true,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        configPath: '/tmp/toollist-config.json',
      },
      {
        runBatchCommand,
      },
    );

    expect(runBatchCommand).toHaveBeenCalledWith(
      {
        manifestPath: '<image-resize-batch>',
        resume: true,
        concurrency: 2,
        outputDir: join(tempDir, 'outputs'),
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        configPath: '/tmp/toollist-config.json',
      },
      expect.objectContaining({
        readBatchManifest: expect.any(Function),
      }),
    );

    const readBatchManifest = runBatchCommand.mock.calls[0]?.[1]?.readBatchManifest as
      | (() => Promise<{
          version: 1;
          defaults?: Record<string, unknown>;
          items: Array<Record<string, unknown>>;
        }>)
      | undefined;

    const manifest = await readBatchManifest?.();

    expect(manifest).toMatchObject({
      version: 1,
      defaults: {
        base_url: 'https://api.example.com',
        concurrency: 2,
        wait: true,
        download_outputs: true,
        output_dir: join(tempDir, 'outputs'),
      },
      items: [
        {
          id: 'resize-001',
          tool_name: 'image.resize',
          input_path: first,
          input: {
            width: 1200,
            target_mime_type: 'image/webp',
            quality: 35,
          },
        },
        {
          id: 'resize-002',
          tool_name: 'image.resize',
          input_path: second,
          input: {
            width: 1200,
            target_mime_type: 'image/webp',
            quality: 35,
          },
        },
      ],
    });
    expect(result.summary.total).toBe(2);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('deduplicates overlapping inputs through the shared batch manifest helper', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-resize-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    await writeFile(first, 'a');
    await writeFile(second, 'b');

    const { buildHomogeneousImageBatchManifest } = await import(
      '../../src/commands/image/homogeneous-batch-manifest.js'
    );

    const resizeManifest = await buildHomogeneousImageBatchManifest({
      inputs: [first],
      inputGlob: join(tempDir, '*.jpg'),
      toolName: 'image.resize',
      idPrefix: 'resize',
      buildInput: () => ({
        width: 640,
      }),
    });

    const cropManifest = await buildHomogeneousImageBatchManifest({
      inputs: [first],
      inputGlob: join(tempDir, '*.jpg'),
      toolName: 'image.crop',
      idPrefix: 'crop',
      buildInput: () => ({
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      }),
    });

    expect(resizeManifest.items.map((item) => item.input_path)).toEqual([first, second]);
    expect(cropManifest.items.map((item) => item.input_path)).toEqual([first, second]);
    expect(resizeManifest.items[0]?.id).toBe('resize-001');
    expect(cropManifest.items[0]?.id).toBe('crop-001');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('supports glob implementations that resolve to an array of matches', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-resize-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    await writeFile(first, 'a');
    await writeFile(second, 'b');

    const { buildHomogeneousImageBatchManifest } = await import(
      '../../src/commands/image/homogeneous-batch-manifest.js'
    );

    const manifest = await buildHomogeneousImageBatchManifest(
      {
        inputGlob: join(tempDir, '*.jpg'),
        toolName: 'image.resize',
        idPrefix: 'resize',
        buildInput: () => ({
          width: 640,
        }),
      },
      {
        glob: async () => [first, second],
      },
    );

    expect(manifest.items.map((item) => item.input_path)).toEqual([first, second]);

    await rm(tempDir, { recursive: true, force: true });
  });
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

describe('image resize-batch command', () => {
  it('prints dedicated help for resize-batch', async () => {
    const result = await runCli(['image', 'resize-batch', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist image resize-batch');
    expect(result.stdout).toContain('--inputs <path...>');
    expect(result.stdout).toContain('--input-glob <pattern>');
    expect(result.stdout).toContain('--output-dir <path>');
  });

  it('accepts image resize-batch with explicit --inputs', async () => {
    const imageResizeBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: {
        total: 2,
        succeeded: 2,
        failed: 0,
        skipped: 0,
      },
      items: [],
    }));
    vi.doMock('../../src/commands/image/resize-batch.js', () => ({
      buildResizeBatchManifest: vi.fn(),
      imageResizeBatchCommand,
    }));

    const result = await runCli([
      'image',
      'resize-batch',
      '--inputs',
      '/tmp/photo-a.jpg',
      '/tmp/photo-b.jpg',
      '--width',
      '640',
      '--to',
      'webp',
      '--quality',
      '35',
      '--concurrency',
      '2',
      '--wait',
      '--output-dir',
      '/tmp/outputs',
      '--resume',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--config-path',
      '/tmp/toollist-config.json',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(imageResizeBatchCommand).toHaveBeenCalledWith({
      inputs: ['/tmp/photo-a.jpg', '/tmp/photo-b.jpg'],
      inputGlob: undefined,
      width: 640,
      height: undefined,
      to: 'webp',
      quality: 35,
      concurrency: 2,
      wait: true,
      outputDir: '/tmp/outputs',
      resume: true,
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      configPath: '/tmp/toollist-config.json',
      env: undefined,
    });
  });

  it('accepts image resize-batch with --input-glob', async () => {
    const imageResizeBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: {
        total: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      },
      items: [],
    }));
    vi.doMock('../../src/commands/image/resize-batch.js', () => ({
      buildResizeBatchManifest: vi.fn(),
      imageResizeBatchCommand,
    }));

    const result = await runCli([
      'image',
      'resize-batch',
      '--input-glob',
      '/tmp/photos/*.jpg',
      '--height',
      '480',
      '--concurrency',
      '3',
      '--output-dir',
      '/tmp/outputs',
      '--wait',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(imageResizeBatchCommand).toHaveBeenCalledWith({
      inputs: undefined,
      inputGlob: '/tmp/photos/*.jpg',
      width: undefined,
      height: 480,
      to: undefined,
      concurrency: 3,
      wait: true,
      outputDir: '/tmp/outputs',
      resume: undefined,
      baseUrl: 'https://api.example.com',
      token: 'tgc_cli_secret',
      configPath: undefined,
      env: undefined,
    });
  });

  it('accepts image resize-batch with --env and resolves the hosted base URL', async () => {
    const imageResizeBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: {
        total: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      },
      items: [],
    }));
    vi.doMock('../../src/commands/image/resize-batch.js', () => ({
      buildResizeBatchManifest: vi.fn(),
      imageResizeBatchCommand,
    }));

    const result = await runCli([
      'image',
      'resize-batch',
      '--inputs',
      '/tmp/photo-a.jpg',
      '--width',
      '1600',
      '--env',
      'dev',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(imageResizeBatchCommand).toHaveBeenCalledWith({
      inputs: ['/tmp/photo-a.jpg'],
      inputGlob: undefined,
      width: 1600,
      height: undefined,
      to: undefined,
      concurrency: undefined,
      wait: undefined,
      outputDir: undefined,
      resume: undefined,
      baseUrl: 'http://localhost:3024',
      token: 'tgc_cli_secret',
      configPath: undefined,
      env: 'dev',
    });
  });

  it('maps --compress smallest to quality 35 for image resize-batch', async () => {
    const imageResizeBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
      items: [],
    }));
    vi.doMock('../../src/commands/image/resize-batch.js', () => ({
      buildResizeBatchManifest: vi.fn(),
      imageResizeBatchCommand,
    }));

    const result = await runCli([
      'image',
      'resize-batch',
      '--inputs',
      '/tmp/photo-a.png',
      '--width',
      '640',
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
    expect(imageResizeBatchCommand).toHaveBeenCalledWith(expect.objectContaining({
      quality: 35,
    }));
  });

  it('rejects resize-batch when neither width nor height is provided', async () => {
    const result = await runCli([
      'image',
      'resize-batch',
      '--inputs',
      '/tmp/photo-a.jpg',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/width|height/i);
  });
});
