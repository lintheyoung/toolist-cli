import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/image/crop-batch.js');
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

describe('image crop-batch command', () => {
  it('prints dedicated help for crop-batch', async () => {
    const result = await runCli(['image', 'crop-batch', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist image crop-batch');
    expect(result.stdout).toContain('--inputs <path...>');
    expect(result.stdout).toContain('--input-glob <pattern>');
    expect(result.stdout).toContain('--x <pixels>');
    expect(result.stdout).toContain('--y <pixels>');
    expect(result.stdout).toContain('--width <pixels>');
    expect(result.stdout).toContain('--height <pixels>');
  });

  it('accepts image crop-batch with explicit --inputs', async () => {
    const imageCropBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: {
        total: 2,
        succeeded: 2,
        failed: 0,
        skipped: 0,
      },
      items: [],
    }));
    vi.doMock('../../src/commands/image/crop-batch.js', () => ({
      buildCropBatchManifest: vi.fn(),
      imageCropBatchCommand,
    }));

    const result = await runCli([
      'image',
      'crop-batch',
      '--inputs',
      '/tmp/photo-a.jpg',
      '/tmp/photo-b.jpg',
      '--x',
      '10',
      '--y',
      '20',
      '--width',
      '640',
      '--height',
      '480',
      '--to',
      'webp',
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
    expect(imageCropBatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: ['/tmp/photo-a.jpg', '/tmp/photo-b.jpg'],
        x: 10,
        y: 20,
        width: 640,
        height: 480,
        to: 'webp',
        concurrency: 2,
        wait: true,
        outputDir: '/tmp/outputs',
        resume: true,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        configPath: '/tmp/toollist-config.json',
      }),
    );
  });

  it('accepts image crop-batch with --input-glob', async () => {
    const imageCropBatchCommand = vi.fn(async () => ({
      batch_id: 'batch_123',
      summary: {
        total: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      },
      items: [],
    }));
    vi.doMock('../../src/commands/image/crop-batch.js', () => ({
      buildCropBatchManifest: vi.fn(),
      imageCropBatchCommand,
    }));

    const result = await runCli([
      'image',
      'crop-batch',
      '--input-glob',
      '/tmp/photos/*.jpg',
      '--x',
      '5',
      '--y',
      '15',
      '--width',
      '320',
      '--height',
      '240',
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
    expect(imageCropBatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        inputGlob: '/tmp/photos/*.jpg',
        x: 5,
        y: 15,
        width: 320,
        height: 240,
        concurrency: 3,
        outputDir: '/tmp/outputs',
        wait: true,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
      }),
    );
  });

  it('rejects crop-batch when x, y, width, or height is missing', async () => {
    const result = await runCli([
      'image',
      'crop-batch',
      '--inputs',
      '/tmp/photo-a.jpg',
      '--y',
      '20',
      '--width',
      '640',
      '--height',
      '480',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--x|--y|--width|--height/i);
  });

  it('builds a crop-batch manifest from explicit inputs through the shared helper', async () => {
    const { buildHomogeneousImageBatchManifest } = await import(
      '../../src/commands/image/homogeneous-batch-manifest.js'
    );

    const manifest = await buildHomogeneousImageBatchManifest({
      inputs: ['/tmp/photo-a.jpg', '/tmp/photo-b.jpg'],
      toolName: 'image.crop',
      idPrefix: 'crop',
      buildInput: () => ({
        x: 10,
        y: 20,
        width: 640,
        height: 480,
      }),
    });

    expect(manifest.items).toHaveLength(2);
    expect(manifest.items[0]).toMatchObject({
      id: 'crop-001',
      tool_name: 'image.crop',
      input_path: expect.stringContaining('/tmp/photo-a.jpg'),
      input: {
        x: 10,
        y: 20,
        width: 640,
        height: 480,
      },
    });
    expect(manifest.items[1]).toMatchObject({
      id: 'crop-002',
      tool_name: 'image.crop',
      input_path: expect.stringContaining('/tmp/photo-b.jpg'),
    });
  });

  it('delegates synthesized crop manifest and credentials into runBatchCommand', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-crop-batch-'));
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
        { id: 'crop-001', status: 'succeeded' },
        { id: 'crop-002', status: 'succeeded' },
      ],
    }));

    const { imageCropBatchCommand } = await import(
      '../../src/commands/image/crop-batch.js'
    );

    const result = await imageCropBatchCommand(
      {
        inputs: [first, second],
        x: 10,
        y: 20,
        width: 640,
        height: 480,
        to: 'webp',
        quality: 80,
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
        manifestPath: '<image-crop-batch>',
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
          id: 'crop-001',
          tool_name: 'image.crop',
          input_path: first,
          input: {
            x: 10,
            y: 20,
            width: 640,
            height: 480,
            target_mime_type: 'image/webp',
            quality: 80,
          },
        },
        {
          id: 'crop-002',
          tool_name: 'image.crop',
          input_path: second,
          input: {
            x: 10,
            y: 20,
            width: 640,
            height: 480,
            target_mime_type: 'image/webp',
            quality: 80,
          },
        },
      ],
    });
    expect(result.summary.total).toBe(2);

    await rm(tempDir, { recursive: true, force: true });
  });
});
