import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createStoredZipArchive } from '../../src/lib/zip-batch-input.js';
import { mergeChunkZipOutputs } from '../../src/lib/zip-merge.js';

function readStoredZipEntries(bytes: Buffer): Map<string, Buffer> {
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

describe('mergeChunkZipOutputs', () => {
  it('merges chunk result zips under deterministic chunk directories and writes an aggregate manifest', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-zip-merge-'));
    const firstZip = join(tempDir, 'chunk-1.zip');
    const secondZip = join(tempDir, 'chunk-2.zip');
    const outputPath = join(tempDir, 'results.zip');

    await writeFile(
      firstZip,
      createStoredZipArchive([
        { name: 'photo.png', data: Buffer.from('first photo') },
        {
          name: 'manifest.json',
          data: Buffer.from(JSON.stringify({ processedFileCount: 1, skippedFileCount: 0 })),
        },
      ]),
    );
    await writeFile(
      secondZip,
      createStoredZipArchive([
        { name: 'photo.png', data: Buffer.from('second photo') },
        { name: 'other.png', data: Buffer.from('other photo') },
        {
          name: 'manifest.json',
          data: Buffer.from(JSON.stringify({ processedFileCount: 2, skippedFileCount: 1 })),
        },
      ]),
    );

    const manifest = await mergeChunkZipOutputs({
      outputPath,
      chunks: [
        {
          index: 1,
          jobId: 'job_chunk_1',
          inputCount: 1,
          status: 'succeeded',
          zipPath: firstZip,
        },
        {
          index: 2,
          jobId: 'job_chunk_2',
          inputCount: 2,
          status: 'succeeded',
          zipPath: secondZip,
        },
      ],
    });

    expect(manifest.totalInputCount).toBe(3);
    expect(manifest.processedFileCount).toBe(3);
    expect(manifest.skippedFileCount).toBe(1);
    expect(manifest.chunks).toEqual([
      expect.objectContaining({
        index: 1,
        jobId: 'job_chunk_1',
        inputCount: 1,
        status: 'succeeded',
        manifest: { processedFileCount: 1, skippedFileCount: 0 },
      }),
      expect.objectContaining({
        index: 2,
        jobId: 'job_chunk_2',
        inputCount: 2,
        status: 'succeeded',
        manifest: { processedFileCount: 2, skippedFileCount: 1 },
      }),
    ]);

    const entries = readStoredZipEntries(await readFile(outputPath));
    expect([...entries.keys()]).toEqual([
      'chunk-001/photo.png',
      'chunk-001/manifest.json',
      'chunk-002/photo.png',
      'chunk-002/other.png',
      'chunk-002/manifest.json',
      'manifest.json',
    ]);
    expect(entries.get('chunk-001/photo.png')?.toString('utf8')).toBe('first photo');
    expect(entries.get('chunk-002/photo.png')?.toString('utf8')).toBe('second photo');
    expect(JSON.parse(entries.get('manifest.json')!.toString('utf8'))).toEqual(manifest);

    await rm(tempDir, { recursive: true, force: true });
  });
});
