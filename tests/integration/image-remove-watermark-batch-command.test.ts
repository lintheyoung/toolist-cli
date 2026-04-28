import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStoredZipArchive } from '../../src/lib/zip-batch-input.js';

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

function readZipEntries(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const endOfCentralDirectorySignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;
  const localFileSignature = 0x04034b50;

  let eocdOffset = -1;

  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === endOfCentralDirectorySignature) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Missing end of central directory record.');
  }

  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== centralDirectorySignature) {
      throw new Error('Invalid central directory record.');
    }

    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const fileName = bytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    if (bytes.readUInt32LE(localHeaderOffset) !== localFileSignature) {
      throw new Error('Invalid local file record.');
    }

    if (method !== 0) {
      throw new Error(`Unsupported test ZIP method: ${method}`);
    }

    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    entries.set(fileName, bytes.subarray(dataOffset, dataOffset + compressedSize));

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function createInputFiles(count: number) {
  const tempDir = await mkdtemp(join(tmpdir(), 'toollist-watermark-batch-'));
  const inputs: string[] = [];

  for (let index = 1; index <= count; index += 1) {
    const inputPath = join(tempDir, `image-${String(index).padStart(2, '0')}.png`);
    await writeFile(inputPath, `image ${index}`);
    inputs.push(inputPath);
  }

  return { tempDir, inputs };
}

function createResultZip(chunkIndex: number, inputCount: number): Buffer {
  const firstOutputIndex = (chunkIndex - 1) * 5 + 1;
  const imageEntries = Array.from({ length: inputCount }, (_, index) => ({
    name: `image-${String(firstOutputIndex + index).padStart(2, '0')}.png`,
    data: Buffer.from(`processed ${chunkIndex}-${index + 1}`),
  }));

  return createStoredZipArchive([
    ...imageEntries,
    {
      name: 'manifest.json',
      data: Buffer.from(
        JSON.stringify({
          processedFileCount: inputCount,
          skippedFileCount: 0,
        }),
      ),
    },
  ]);
}

describe('image remove-watermark-batch command', () => {
  it('prints dedicated help for remove-watermark-batch', async () => {
    const result = await runCli(['image', 'remove-watermark-batch', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('toollist image remove-watermark-batch');
    expect(result.stdout).toContain('--inputs <path...>');
    expect(result.stdout).toContain('--input-glob <pattern>');
    expect(result.stdout).toContain('--chunk-size <n>');
    expect(result.stdout).toContain('--threshold <0..1>');
    expect(result.stdout).toContain('--region <region>');
    expect(result.stdout).toContain('--fallback-region <region>');
    expect(result.stdout).toContain('--snap');
    expect(result.stdout).toContain('--no-snap');
    expect(result.stdout).toContain('--snap-max-size <32..320>');
    expect(result.stdout).toContain('--snap-threshold <0..1>');
    expect(result.stdout).toContain('--denoise <ai|ns|telea|soft|off>');
    expect(result.stdout).toContain('--sigma <1..150>');
    expect(result.stdout).toContain('--strength <0..300>');
    expect(result.stdout).toContain('--radius <1..25>');
    expect(result.stdout).toContain('--force');
    expect(result.stdout).toContain('Only use --force when every image should be processed');
    expect(result.stdout).toContain('--output <path>');
  });

  it('keeps the create job input unchanged when tuning flags are omitted', async () => {
    const { tempDir, inputs } = await createInputFiles(1);
    const createJobInputs: unknown[] = [];

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_batch_source_1',
      filename: 'inputs.zip',
      mime_type: 'application/zip',
      size_bytes: 512,
    }));

    const apiRequest = vi.fn(async ({ body }: { body: { input: unknown } }) => {
      createJobInputs.push(body.input);

      return {
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: 'req_create_job_chunk_1',
      };
    });

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-watermark-batch',
      '--inputs',
      ...inputs,
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(createJobInputs).toEqual([
      {
        input_file_id: 'file_batch_source_1',
      },
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('passes tuning fields to every chunk job input', async () => {
    const { tempDir, inputs } = await createInputFiles(6);
    const createJobInputs: unknown[] = [];
    let uploadCount = 0;

    const uploadCommand = vi.fn(async () => {
      uploadCount += 1;

      return {
        file_id: `file_batch_source_${uploadCount}`,
        filename: 'inputs.zip',
        mime_type: 'application/zip',
        size_bytes: 512,
      };
    });

    const apiRequest = vi.fn(async ({ body }: { body: { input: unknown } }) => {
      createJobInputs.push(body.input);
      const chunkIndex = createJobInputs.length;

      return {
        data: {
          job: {
            id: `job_chunk_${chunkIndex}`,
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: `req_create_job_chunk_${chunkIndex}`,
      };
    });

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-watermark-batch',
      '--inputs',
      ...inputs,
      '--chunk-size',
      '3',
      '--threshold',
      '0.42',
      '--region',
      'br:0,0,160,160',
      '--fallback-region',
      '10,20,30,40',
      '--no-snap',
      '--snap-max-size',
      '160',
      '--snap-threshold',
      '0.65',
      '--denoise',
      'ai',
      '--sigma',
      '50',
      '--strength',
      '300',
      '--radius',
      '12',
      '--force',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(createJobInputs).toEqual([
      {
        input_file_id: 'file_batch_source_1',
        threshold: 0.42,
        region: 'br:0,0,160,160',
        fallback_region: '10,20,30,40',
        snap: false,
        snap_max_size: 160,
        snap_threshold: 0.65,
        denoise: 'ai',
        sigma: 50,
        strength: 300,
        radius: 12,
        force: true,
      },
      {
        input_file_id: 'file_batch_source_2',
        threshold: 0.42,
        region: 'br:0,0,160,160',
        fallback_region: '10,20,30,40',
        snap: false,
        snap_max_size: 160,
        snap_threshold: 0.65,
        denoise: 'ai',
        sigma: 50,
        strength: 300,
        radius: 12,
        force: true,
      },
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses the last snap flag when both --snap and --no-snap are present', async () => {
    const { tempDir, inputs } = await createInputFiles(1);
    const createJobInputs: Array<{ snap?: boolean }> = [];

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_batch_source_1',
      filename: 'inputs.zip',
      mime_type: 'application/zip',
      size_bytes: 512,
    }));

    const apiRequest = vi.fn(async ({ body }: { body: { input: { snap?: boolean } } }) => {
      createJobInputs.push(body.input);

      return {
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: 'req_create_job_chunk_1',
      };
    });

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-watermark-batch',
      '--inputs',
      ...inputs,
      '--snap',
      '--no-snap',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(createJobInputs).toEqual([
      {
        input_file_id: 'file_batch_source_1',
        snap: false,
      },
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('fails clearly for invalid tuning flag values', async () => {
    const cases: Array<{ args: string[]; message: string }> = [
      { args: ['--denoise', 'fast'], message: 'Invalid value for --denoise. Expected one of: ai, ns, telea, soft, off.' },
      { args: ['--threshold', '1.5'], message: 'Invalid value for --threshold. Expected a number from 0 to 1.' },
      { args: ['--region', '   '], message: 'Invalid value for --region. Expected a non-empty region.' },
      { args: ['--fallback-region', '   '], message: 'Invalid value for --fallback-region. Expected a non-empty region.' },
      { args: ['--snap-max-size', '31'], message: 'Invalid value for --snap-max-size. Expected an integer from 32 to 320.' },
      { args: ['--snap-threshold', '-0.1'], message: 'Invalid value for --snap-threshold. Expected a number from 0 to 1.' },
      { args: ['--sigma', '151'], message: 'Invalid value for --sigma. Expected a number from 1 to 150.' },
      { args: ['--strength', '301'], message: 'Invalid value for --strength. Expected a number from 0 to 300.' },
      { args: ['--radius', '26'], message: 'Invalid value for --radius. Expected an integer from 1 to 25.' },
    ];

    for (const testCase of cases) {
      const result = await runCli([
        'image',
        'remove-watermark-batch',
        '--inputs',
        './a.png',
        ...testCase.args,
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(testCase.message);
    }
  });

  it('accepts inclusive tuning range boundaries', async () => {
    const { tempDir, inputs } = await createInputFiles(1);
    const createJobInputs: unknown[] = [];

    const uploadCommand = vi.fn(async () => ({
      file_id: 'file_batch_source_1',
      filename: 'inputs.zip',
      mime_type: 'application/zip',
      size_bytes: 512,
    }));

    const apiRequest = vi.fn(async ({ body }: { body: { input: unknown } }) => {
      createJobInputs.push(body.input);

      return {
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: 'req_create_job_chunk_1',
      };
    });

    vi.doMock('../../src/commands/files/upload.js', () => ({
      uploadCommand,
    }));
    vi.doMock('../../src/lib/http.js', () => ({
      apiRequest,
    }));

    const result = await runCli([
      'image',
      'remove-watermark-batch',
      '--inputs',
      ...inputs,
      '--threshold',
      '0',
      '--snap-threshold',
      '1',
      '--snap-max-size',
      '32',
      '--sigma',
      '150',
      '--strength',
      '0',
      '--radius',
      '25',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(createJobInputs).toEqual([
      {
        input_file_id: 'file_batch_source_1',
        threshold: 0,
        snap_threshold: 1,
        snap_max_size: 32,
        sigma: 150,
        strength: 0,
        radius: 25,
      },
    ]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('splits 30 inputs into 6 default chunk jobs, merges outputs, and prints a batch summary', async () => {
    const { tempDir, inputs } = await createInputFiles(30);
    const outputPath = join(tempDir, 'results.zip');
    const uploadedEntryNames: string[][] = [];
    const outputZips = new Map<string, Buffer>();

    const uploadCommand = vi.fn(async ({ input }: { input: string }) => {
      uploadedEntryNames.push([...readZipEntries(await readFile(input)).keys()]);
      const chunkIndex = uploadedEntryNames.length;

      return {
        file_id: `file_batch_source_${chunkIndex}`,
        upload_url: `https://upload.example.com/file_batch_source_${chunkIndex}`,
        headers: {
          'content-type': 'application/zip',
        },
        filename: input.split('/').pop() ?? 'inputs.zip',
        mime_type: 'application/zip',
        size_bytes: 512,
        file: {
          fileId: `file_batch_source_${chunkIndex}`,
          status: 'uploaded',
        },
      };
    });

    const apiRequest = vi.fn(async () => {
      const chunkIndex = uploadedEntryNames.length;

      return {
        data: {
          job: {
            id: `job_chunk_${chunkIndex}`,
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: `req_create_job_chunk_${chunkIndex}`,
      };
    });

    const waitJobCommand = vi.fn(
      async (args: { jobId: string; onStatus?: (status: string, job: unknown) => void }) => {
        const chunkIndex = Number(args.jobId.replace('job_chunk_', ''));
        const inputCount = uploadedEntryNames[chunkIndex - 1]!.length;
        const outputFileId = `file_results_${chunkIndex}`;

        outputZips.set(outputFileId, createResultZip(chunkIndex, inputCount));
        args.onStatus?.('queued', { id: args.jobId, status: 'queued' });
        args.onStatus?.('dispatching', { id: args.jobId, status: 'dispatching' });
        args.onStatus?.('succeeded', { id: args.jobId, status: 'succeeded' });

        return {
          id: args.jobId,
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
          result: {
            output: {
              filename: 'results.zip',
              outputFileId,
              mimeType: 'application/zip',
            },
            batch: {
              summary: {
                processedFileCount: inputCount,
                skippedFileCount: 0,
              },
            },
          },
        };
      },
    );

    const fetch = vi.fn(async (url: string | URL | Request) => {
      const fileId = String(url).match(/files\/([^/]+)\/download/)?.[1];
      const body = fileId ? outputZips.get(fileId) : undefined;

      return new Response(body ?? Buffer.from('missing'), { status: body ? 200 : 404 });
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
      ...inputs,
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
    expect(uploadCommand).toHaveBeenCalledTimes(6);
    expect(apiRequest).toHaveBeenCalledTimes(6);
    expect(waitJobCommand).toHaveBeenCalledTimes(6);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(uploadedEntryNames.map((names) => names.length)).toEqual([5, 5, 5, 5, 5, 5]);
    expect(uploadedEntryNames[0]).toEqual([
      'image-01.png',
      'image-02.png',
      'image-03.png',
      'image-04.png',
      'image-05.png',
    ]);
    expect(JSON.parse(result.stdout)).toEqual({
      chunks: Array.from({ length: 6 }, (_, index) => ({
        index: index + 1,
        jobId: `job_chunk_${index + 1}`,
        inputCount: 5,
        status: 'succeeded',
      })),
      totalInputCount: 30,
      processedFileCount: 30,
      skippedFileCount: 0,
      output: outputPath,
    });

    const finalEntries = readZipEntries(await readFile(outputPath));
    expect([...finalEntries.keys()]).toContain('chunk-001/image-01.png');
    expect([...finalEntries.keys()]).toContain('chunk-006/image-30.png');
    expect([...finalEntries.keys()]).toContain('manifest.json');
    const manifest = JSON.parse(finalEntries.get('manifest.json')!.toString('utf8'));
    expect(manifest.totalInputCount).toBe(30);
    expect(manifest.processedFileCount).toBe(30);
    expect(manifest.chunks).toHaveLength(6);
    expect(result.stderr).toContain('Preparing chunk 1/6 (5 files)...');
    expect(result.stderr).toContain('Preparing chunk 6/6 (5 files)...');
    expect(result.stderr).toContain('Merging chunk outputs...');
    expect(result.stderr).toContain(`Saved output: ${outputPath}`);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('uses --chunk-size 3 when creating no-wait chunk jobs', async () => {
    const { tempDir, inputs } = await createInputFiles(30);
    const uploadedEntryNames: string[][] = [];

    const uploadCommand = vi.fn(async ({ input }: { input: string }) => {
      uploadedEntryNames.push([...readZipEntries(await readFile(input)).keys()]);

      return {
        file_id: `file_batch_source_${uploadedEntryNames.length}`,
        filename: 'inputs.zip',
        mime_type: 'application/zip',
        size_bytes: 512,
      };
    });

    const apiRequest = vi.fn(async () => {
      const chunkIndex = uploadedEntryNames.length;

      return {
        data: {
          job: {
            id: `job_chunk_${chunkIndex}`,
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: `req_create_job_chunk_${chunkIndex}`,
      };
    });

    const waitJobCommand = vi.fn(async () => {
      throw new Error('wait should not be called');
    });
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
      ...inputs,
      '--chunk-size',
      '3',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(0);
    expect(uploadCommand).toHaveBeenCalledTimes(10);
    expect(apiRequest).toHaveBeenCalledTimes(10);
    expect(waitJobCommand).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(uploadedEntryNames.map((names) => names.length)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(JSON.parse(result.stdout)).toEqual({
      chunks: Array.from({ length: 10 }, (_, index) => ({
        index: index + 1,
        jobId: `job_chunk_${index + 1}`,
        inputCount: 3,
        status: 'queued',
      })),
      totalInputCount: 30,
      processedFileCount: 0,
      skippedFileCount: 0,
    });

    await rm(tempDir, { recursive: true, force: true });
  });

  it('fails clearly when --chunk-size is greater than 5', async () => {
    const result = await runCli([
      'image',
      'remove-watermark-batch',
      '--inputs',
      './a.png',
      '--chunk-size',
      '6',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--chunk-size cannot be greater than 5.');
  });

  it('rejects non-positive and non-integer --chunk-size values', async () => {
    for (const value of ['0', '2.5']) {
      const result = await runCli([
        'image',
        'remove-watermark-batch',
        '--inputs',
        './a.png',
        '--chunk-size',
        value,
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Invalid value for --chunk-size.');
    }
  });

  it('adds chunk context while preserving job failure details when a chunk job fails', async () => {
    const { tempDir, inputs } = await createInputFiles(11);
    const uploadedEntryNames: string[][] = [];

    const uploadCommand = vi.fn(async ({ input }: { input: string }) => {
      uploadedEntryNames.push([...readZipEntries(await readFile(input)).keys()]);

      return {
        file_id: `file_batch_source_${uploadedEntryNames.length}`,
        filename: 'inputs.zip',
        mime_type: 'application/zip',
        size_bytes: 512,
      };
    });

    const apiRequest = vi.fn(async () => {
      const chunkIndex = uploadedEntryNames.length;

      return {
        data: {
          job: {
            id: `job_chunk_${chunkIndex}`,
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: `req_create_job_chunk_${chunkIndex}`,
      };
    });

    const waitJobCommand = vi.fn(async (args: { jobId: string }) => {
      if (args.jobId !== 'job_chunk_3') {
        return {
          id: args.jobId,
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
          result: {
            batch: {
              summary: {
                processedFileCount: 5,
                skippedFileCount: 0,
              },
            },
          },
        };
      }

      return {
        id: 'job_chunk_3',
        status: 'failed',
        toolName: 'image.gemini_nb_remove_watermark_batch',
        toolVersion: '2026-04-15',
        error: {
          code: 'PROVIDER_REQUEST_FAILED',
          message: 'Replicate prediction failed',
        },
        progress: {
          externalTaskId: 'prediction_123',
        },
      };
    });

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
      ...inputs,
      '--wait',
      '--base-url',
      'https://api.example.com',
      '--token',
      'tgc_cli_secret',
      '--json',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Chunk failed: 3');
    expect(result.stderr).toContain('Chunk input count: 1');
    expect(result.stderr).toContain('Job failed: job_chunk_3');
    expect(result.stderr).toContain('Status: failed');
    expect(result.stderr).toContain('Error code: PROVIDER_REQUEST_FAILED');
    expect(result.stderr).toContain('Error message: Replicate prediction failed');
    expect(result.stderr).toContain('External task id: prediction_123');

    await rm(tempDir, { recursive: true, force: true });
  });

  it('waits for outputFileId visibility before downloading a succeeded chunk output', async () => {
    const { imageRemoveWatermarkBatchCommand } = await import(
      '../../src/commands/image/remove-watermark-batch.js'
    );
    const apiRequest = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: 'req_create_job_chunk_1',
      })
      .mockResolvedValueOnce({
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'succeeded',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
            result: {
              batch: {
                summary: {
                  processedFileCount: 1,
                  skippedFileCount: 0,
                },
              },
            },
          },
        },
        request_id: 'req_get_job_no_output',
      })
      .mockResolvedValueOnce({
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'succeeded',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
            result: {
              output: {
                filename: 'results.zip',
                outputFileId: 'file_results_1',
                mimeType: 'application/zip',
              },
              batch: {
                summary: {
                  processedFileCount: 1,
                  skippedFileCount: 0,
                },
              },
            },
          },
        },
        request_id: 'req_get_job_with_output',
      });
    const fetch = vi.fn(async () => new Response(Buffer.from('zip'), { status: 200 }));
    const sleep = vi.fn(async () => undefined);

    const result = await imageRemoveWatermarkBatchCommand(
      {
        inputs: ['/tmp/a.jpg'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        wait: true,
        output: '/tmp/results.zip',
        outputFileIdTimeoutMs: 1_000,
        outputFileIdPollIntervalMs: 1,
      },
      {
        resolveZipBatchInputPaths: vi.fn(async () => ['/tmp/a.jpg']),
        createZipBatchInput: vi.fn(async () => ({
          zipPath: '/tmp/caller-owned/inputs.zip',
          inputCount: 1,
        })),
        uploadCommand: vi.fn(async () => ({
          file_id: 'file_batch_source_1',
        })),
        waitJobCommand: vi.fn(async () => ({
          id: 'job_chunk_1',
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
          result: {
            batch: {
              summary: {
                processedFileCount: 1,
                skippedFileCount: 0,
              },
            },
          },
        })),
        apiRequest,
        fetch,
        sleep,
        writeFile: vi.fn(async () => undefined),
        mkdtemp: vi.fn(async () => '/tmp/toollist-watermark-batch-output-test'),
        rm: vi.fn(async () => undefined),
        mergeChunkZipOutputs: vi.fn(async () => ({
          processedFileCount: 1,
          skippedFileCount: 0,
        })),
      },
    );

    expect(result.output).toBe('/tmp/results.zip');
    expect(apiRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: 'GET',
      path: '/api/v1/jobs/job_chunk_1',
      stage: 'Output file lookup failed',
    }));
    expect(apiRequest).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: 'GET',
      path: '/api/v1/jobs/job_chunk_1',
      stage: 'Output file lookup failed',
    }));
    expect(sleep).toHaveBeenCalledWith(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not refresh job detail when the succeeded chunk already has outputFileId', async () => {
    const { imageRemoveWatermarkBatchCommand } = await import(
      '../../src/commands/image/remove-watermark-batch.js'
    );
    const apiRequest = vi.fn(async () => ({
      data: {
        job: {
          id: 'job_chunk_1',
          status: 'queued',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
        },
      },
      request_id: 'req_create_job_chunk_1',
    }));

    await imageRemoveWatermarkBatchCommand(
      {
        inputs: ['/tmp/a.jpg'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        wait: true,
        output: '/tmp/results.zip',
      },
      {
        resolveZipBatchInputPaths: vi.fn(async () => ['/tmp/a.jpg']),
        createZipBatchInput: vi.fn(async () => ({
          zipPath: '/tmp/caller-owned/inputs.zip',
          inputCount: 1,
        })),
        uploadCommand: vi.fn(async () => ({
          file_id: 'file_batch_source_1',
        })),
        waitJobCommand: vi.fn(async () => ({
          id: 'job_chunk_1',
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
          result: {
            output: {
              filename: 'results.zip',
              outputFileId: 'file_results_1',
              mimeType: 'application/zip',
            },
          },
        })),
        apiRequest,
        fetch: vi.fn(async () => new Response(Buffer.from('zip'), { status: 200 })),
        writeFile: vi.fn(async () => undefined),
        mkdtemp: vi.fn(async () => '/tmp/toollist-watermark-batch-output-test'),
        rm: vi.fn(async () => undefined),
        mergeChunkZipOutputs: vi.fn(async () => ({
          processedFileCount: 1,
          skippedFileCount: 0,
        })),
      },
    );

    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('fails with chunk and job detail when outputFileId never becomes visible', async () => {
    const { imageRemoveWatermarkBatchCommand } = await import(
      '../../src/commands/image/remove-watermark-batch.js'
    );
    const apiRequest = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: 'req_create_job_chunk_1',
      })
      .mockResolvedValue({
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'succeeded',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
            result: {
              batch: {
                summary: {
                  processedFileCount: 1,
                  skippedFileCount: 0,
                },
              },
            },
          },
        },
        request_id: 'req_get_job_no_output',
      });

    await expect(imageRemoveWatermarkBatchCommand(
      {
        inputs: ['/tmp/a.jpg'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        wait: true,
        output: '/tmp/results.zip',
        outputFileIdTimeoutMs: 1,
        outputFileIdPollIntervalMs: 1,
      },
      {
        resolveZipBatchInputPaths: vi.fn(async () => ['/tmp/a.jpg']),
        createZipBatchInput: vi.fn(async () => ({
          zipPath: '/tmp/caller-owned/inputs.zip',
          inputCount: 1,
        })),
        uploadCommand: vi.fn(async () => ({
          file_id: 'file_batch_source_1',
        })),
        waitJobCommand: vi.fn(async () => ({
          id: 'job_chunk_1',
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
          result: {
            batch: {
              summary: {
                processedFileCount: 1,
                skippedFileCount: 0,
              },
            },
          },
        })),
        apiRequest,
        sleep: vi.fn(async () => undefined),
        mkdtemp: vi.fn(async () => '/tmp/toollist-watermark-batch-output-test'),
        rm: vi.fn(async () => undefined),
      },
    )).rejects.toThrow(
      /Chunk failed: 1[\s\S]*Job failed: job_chunk_1[\s\S]*Status: succeeded[\s\S]*Timed out waiting for outputFileId[\s\S]*"result"/,
    );
  });

  it('retries transient errors while refreshing outputFileId visibility', async () => {
    const { imageRemoveWatermarkBatchCommand } = await import(
      '../../src/commands/image/remove-watermark-batch.js'
    );
    const retryEvents: string[] = [];
    const apiRequest = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'queued',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
          },
        },
        request_id: 'req_create_job_chunk_1',
      })
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        data: {
          job: {
            id: 'job_chunk_1',
            status: 'succeeded',
            toolName: 'image.gemini_nb_remove_watermark_batch',
            toolVersion: '2026-04-15',
            result: {
              output: {
                filename: 'results.zip',
                outputFileId: 'file_results_1',
                mimeType: 'application/zip',
              },
            },
          },
        },
        request_id: 'req_get_job_with_output',
      });

    await imageRemoveWatermarkBatchCommand(
      {
        inputs: ['/tmp/a.jpg'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        wait: true,
        output: '/tmp/results.zip',
        outputFileIdTimeoutMs: 1_000,
        outputFileIdPollIntervalMs: 1,
        onRetry: (event) => {
          retryEvents.push(`${event.stage}:${event.retryAttempt}/${event.maxAttempts}`);
        },
      },
      {
        resolveZipBatchInputPaths: vi.fn(async () => ['/tmp/a.jpg']),
        createZipBatchInput: vi.fn(async () => ({
          zipPath: '/tmp/caller-owned/inputs.zip',
          inputCount: 1,
        })),
        uploadCommand: vi.fn(async () => ({
          file_id: 'file_batch_source_1',
        })),
        waitJobCommand: vi.fn(async () => ({
          id: 'job_chunk_1',
          status: 'succeeded',
          toolName: 'image.gemini_nb_remove_watermark_batch',
          toolVersion: '2026-04-15',
        })),
        apiRequest,
        fetch: vi.fn(async () => new Response(Buffer.from('zip'), { status: 200 })),
        sleep: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => undefined),
        mkdtemp: vi.fn(async () => '/tmp/toollist-watermark-batch-output-test'),
        rm: vi.fn(async () => undefined),
        mergeChunkZipOutputs: vi.fn(async () => ({
          processedFileCount: 1,
          skippedFileCount: 0,
        })),
      },
    );

    expect(apiRequest).toHaveBeenCalledTimes(3);
    expect(retryEvents).toEqual(['Output file lookup failed:1/3']);
  });

  it('only cleans up temp directories it created itself', async () => {
    const rmMock = vi.fn(async () => undefined);
    const { imageRemoveWatermarkBatchCommand } = await import(
      '../../src/commands/image/remove-watermark-batch.js'
    );

    await imageRemoveWatermarkBatchCommand(
      {
        inputs: ['/tmp/a.jpg', '/tmp/b.jpg'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        chunkSize: 1,
      },
      {
        resolveZipBatchInputPaths: vi.fn(async () => ['/tmp/a.jpg', '/tmp/b.jpg']),
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
        uploadCommand: vi.fn(async ({ input }: { input: string }) => ({
          file_id: input.includes('caller-owned') ? 'file_batch_1' : 'file_batch_2',
        })),
        apiRequest: vi.fn(async ({ body }: { body: { input: { input_file_id: string } } }) => ({
          data: {
            job: {
              id: body.input.input_file_id === 'file_batch_1' ? 'job_chunk_1' : 'job_chunk_2',
              status: 'queued',
              toolName: 'image.gemini_nb_remove_watermark_batch',
              toolVersion: '2026-04-15',
            },
          },
          request_id: 'req_job_cleanup',
        })),
        rm: rmMock,
      },
    );

    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith('/tmp/tool-owned', {
      recursive: true,
      force: true,
    });
  });

  it('omits undefined tuning fields from direct command calls', async () => {
    const createJobInputs: unknown[] = [];
    const { imageRemoveWatermarkBatchCommand } = await import(
      '../../src/commands/image/remove-watermark-batch.js'
    );

    await imageRemoveWatermarkBatchCommand(
      {
        inputs: ['/tmp/a.jpg'],
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        tuning: {
          threshold: undefined,
          region: 'br:0,0,160,160',
          fallbackRegion: undefined,
          snap: false,
          snapMaxSize: undefined,
          snapThreshold: undefined,
          denoise: undefined,
          sigma: undefined,
          strength: 0,
          radius: undefined,
          force: undefined,
        },
      },
      {
        resolveZipBatchInputPaths: vi.fn(async () => ['/tmp/a.jpg']),
        createZipBatchInput: vi.fn(async () => ({
          zipPath: '/tmp/caller-owned/inputs.zip',
          inputCount: 1,
        })),
        uploadCommand: vi.fn(async () => ({
          file_id: 'file_batch_source_1',
        })),
        apiRequest: vi.fn(async ({ body }: { body: { input: unknown } }) => {
          createJobInputs.push(body.input);

          return {
            data: {
              job: {
                id: 'job_chunk_1',
                status: 'queued',
                toolName: 'image.gemini_nb_remove_watermark_batch',
                toolVersion: '2026-04-15',
              },
            },
            request_id: 'req_job_undefined_tuning',
          };
        }),
      },
    );

    expect(Object.keys(createJobInputs[0] as Record<string, unknown>).sort()).toEqual([
      'input_file_id',
      'region',
      'snap',
      'strength',
    ]);
    expect(createJobInputs[0]).toStrictEqual({
      input_file_id: 'file_batch_source_1',
      region: 'br:0,0,160,160',
      snap: false,
      strength: 0,
    });
  });
});
