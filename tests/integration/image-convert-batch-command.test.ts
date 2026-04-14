import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/image/convert-batch.js');
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

describe('image convert-batch command', () => {
  it('prints dedicated help for convert-batch', async () => {
    const result = await runCli(['image', 'convert-batch', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist image convert-batch');
    expect(result.stdout).toContain('--inputs <path...>');
    expect(result.stdout).toContain('--input-glob <pattern>');
    expect(result.stdout).toContain('--to <format>');
  });

  it('accepts image convert-batch with explicit --inputs', async () => {
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    const result = await runCli([
      'image',
      'convert-batch',
      '--inputs',
      '/tmp/photo-a.jpg',
      '/tmp/photo-b.jpg',
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
  });

  it('accepts image convert-batch with --input-glob', async () => {
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-convert-batch-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    await writeFile(first, 'a');
    await writeFile(second, 'b');

    const result = await runCli([
      'image',
      'convert-batch',
      '--input-glob',
      join(tempDir, '*.jpg'),
      '--to',
      'png',
      '--concurrency',
      '3',
      '--wait',
      '--output-dir',
      '/tmp/outputs',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects convert-batch when --to is missing', async () => {
    const result = await runCli([
      'image',
      'convert-batch',
      '--inputs',
      '/tmp/photo-a.jpg',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--to/i);
  });

  it('builds a convert-batch manifest from explicit inputs through the shared helper', async () => {
    const { buildHomogeneousImageBatchManifest } = await import(
      '../../src/commands/image/homogeneous-batch-manifest.js'
    );

    const manifest = await buildHomogeneousImageBatchManifest({
      inputs: ['/tmp/photo-a.jpg', '/tmp/photo-b.jpg'],
      toolName: 'image.convert_format',
      idPrefix: 'convert',
      buildInput: () => ({
        target_mime_type: 'image/webp',
      }),
    });

    expect(manifest.items).toHaveLength(2);
    expect(manifest.items[0]).toMatchObject({
      id: 'convert-001',
      tool_name: 'image.convert_format',
      input_path: expect.stringContaining('/tmp/photo-a.jpg'),
      input: {
        target_mime_type: 'image/webp',
      },
    });
    expect(manifest.items[1]).toMatchObject({
      id: 'convert-002',
      tool_name: 'image.convert_format',
      input_path: expect.stringContaining('/tmp/photo-b.jpg'),
    });
  });

  it('delegates synthesized manifest and credentials into runBatchCommand', async () => {
    vi.doMock('../../src/commands/image/convert-input-policy.js', () => ({
      assertSupportedConvertInputPath: vi.fn(async () => undefined),
    }));
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-convert-batch-'));
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
        { id: 'convert-001', status: 'succeeded' },
        { id: 'convert-002', status: 'succeeded' },
      ],
    }));

    const { imageConvertBatchCommand } = await import(
      '../../src/commands/image/convert-batch.js'
    );

    const result = await imageConvertBatchCommand(
      {
        inputs: [first, second],
        to: 'webp',
        quality: 92,
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
        manifestPath: '<image-convert-batch>',
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
          id: 'convert-001',
          tool_name: 'image.convert_format',
          input_path: first,
          input: {
            target_mime_type: 'image/webp',
            quality: 92,
          },
        },
        {
          id: 'convert-002',
          tool_name: 'image.convert_format',
          input_path: second,
          input: {
            target_mime_type: 'image/webp',
            quality: 92,
          },
        },
      ],
    });
    expect(result.summary.total).toBe(2);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('fails early for the known unsupported tiny grayscale+alpha PNG input', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-convert-batch-'));
    const inputPath = join(tempDir, 'tiny-ga.png');
    await writeFile(inputPath, UNSUPPORTED_TINY_GRAYSCALE_ALPHA_PNG);

    const result = await runCli([
      'image',
      'convert-batch',
      '--inputs',
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

    await rm(tempDir, { recursive: true, force: true });
  });
});
