import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('node:fs/promises');
  vi.doUnmock('glob');
});

function readZipEntryNames(bytes: Buffer): string[] {
  const entryNames: string[] = [];
  const endOfCentralDirectorySignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;

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

    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const fileName = bytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');

    entryNames.push(fileName);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entryNames;
}

function readZipFlags(bytes: Buffer): { localFlags: number[]; centralFlags: number[] } {
  const localFlags: number[] = [];
  const centralFlags: number[] = [];
  const localFileSignature = 0x04034b50;
  const endOfCentralDirectorySignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;

  let offset = 0;

  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === localFileSignature) {
    localFlags.push(bytes.readUInt16LE(offset + 6));

    const fileNameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const compressedSize = bytes.readUInt32LE(offset + 18);

    offset += 30 + fileNameLength + extraLength + compressedSize;
  }

  let eocdOffset = -1;

  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (bytes.readUInt32LE(index) === endOfCentralDirectorySignature) {
      eocdOffset = index;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Missing end of central directory record.');
  }

  offset = bytes.readUInt32LE(eocdOffset + 16);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);

  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== centralDirectorySignature) {
      throw new Error('Invalid central directory record.');
    }

    centralFlags.push(bytes.readUInt16LE(offset + 8));

    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return { localFlags, centralFlags };
}

describe('createZipBatchInput', () => {
  it('creates a real zip archive from explicit and globbed inputs while deduplicating overlaps', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-zip-batch-input-'));
    const outputDir = join(tempDir, 'zip-output');
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');
    const ignored = join(tempDir, 'notes.txt');

    await writeFile(first, 'first');
    await writeFile(second, 'second');
    await writeFile(ignored, 'ignore');

    const { createZipBatchInput } = await import('../../src/lib/zip-batch-input.js');

    const result = await createZipBatchInput({
      inputs: [first],
      inputGlob: join(tempDir, '*.jpg'),
      outputDir,
    });

    expect(result.inputCount).toBe(2);
    expect(result.zipPath).toBe(join(outputDir, 'inputs.zip'));
    expect(result.cleanupPath).toBeUndefined();
    await expect(access(result.zipPath)).resolves.toBeUndefined();

    const zipBytes = await readFile(result.zipPath);
    const entryNames = readZipEntryNames(zipBytes);

    expect(entryNames).toEqual(['a.jpg', 'b.jpg']);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates and reports an owned temp directory when no outputDir is provided', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-zip-batch-input-'));
    const first = join(tempDir, 'a.jpg');

    await writeFile(first, 'first');

    const { createZipBatchInput } = await import('../../src/lib/zip-batch-input.js');

    const result = await createZipBatchInput({
      inputs: [first],
    });

    expect(result.inputCount).toBe(1);
    expect(result.cleanupPath).toBeDefined();
    expect(result.cleanupPath?.endsWith(`${sep}`)).toBe(false);
    expect(result.zipPath).toBe(join(result.cleanupPath!, 'inputs.zip'));

    await rm(result.cleanupPath!, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  });

  it('sets the UTF-8 filename flag and preserves non-ASCII entry names', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-zip-batch-input-'));
    const outputDir = join(tempDir, 'zip-output');
    const unicodeFile = join(tempDir, 'cafe-你好.png');

    await writeFile(unicodeFile, 'unicode');

    const { createZipBatchInput } = await import('../../src/lib/zip-batch-input.js');

    const result = await createZipBatchInput({
      inputs: [unicodeFile],
      outputDir,
    });

    const zipBytes = await readFile(result.zipPath);
    const entryNames = readZipEntryNames(zipBytes);
    const flags = readZipFlags(zipBytes);

    expect(entryNames).toEqual(['cafe-你好.png']);
    expect(flags.localFlags).toEqual([0x0800]);
    expect(flags.centralFlags).toEqual([0x0800]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('cleans up an owned temp directory when zip assembly fails after mkdtemp', async () => {
    const rmMock = vi.fn(async () => undefined);
    const createdTempDir = join(tmpdir(), 'toollist-watermark-batch-input-cleanup-test');

    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

      return {
        ...actual,
        mkdtemp: vi.fn(async () => createdTempDir),
        mkdir: vi.fn(async () => undefined),
        readFile: vi.fn(async () => {
          throw new Error('boom');
        }),
        rm: rmMock,
      };
    });

    const { createZipBatchInput } = await import('../../src/lib/zip-batch-input.js');

    await expect(
      createZipBatchInput({
        inputs: ['/tmp/does-not-matter.jpg'],
      }),
    ).rejects.toThrow('boom');

    expect(rmMock).toHaveBeenCalledWith(createdTempDir, {
      recursive: true,
      force: true,
    });
  });

  it('expands input globs through the direct glob dependency', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-zip-batch-input-'));
    const first = join(tempDir, 'a.jpg');
    const second = join(tempDir, 'b.jpg');

    await writeFile(first, 'first');
    await writeFile(second, 'second');

    const globMock = vi.fn(async () => [first, second]);
    vi.doMock('glob', () => ({
      glob: globMock,
    }));

    const { createZipBatchInput } = await import('../../src/lib/zip-batch-input.js');

    const result = await createZipBatchInput({
      inputGlob: join(tempDir, '*.jpg'),
      outputDir: join(tempDir, 'zip-output'),
    });

    expect(globMock).toHaveBeenCalledWith(join(tempDir, '*.jpg'));
    expect(result.inputCount).toBe(2);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('rejects empty input sets', async () => {
    const { createZipBatchInput } = await import('../../src/lib/zip-batch-input.js');

    await expect(
      createZipBatchInput({
        inputs: [],
      }),
    ).rejects.toThrow(/at least one input/i);
  });
});
