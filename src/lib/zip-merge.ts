import { inflateRawSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';

import { createStoredZipArchive, type StoredZipEntryInput } from './zip-batch-input.js';

export interface MergeChunkZipOutput {
  index: number;
  jobId: string;
  inputCount: number;
  status: string;
  zipPath: string;
  processedFileCount?: number;
  skippedFileCount?: number;
}

export interface MergedChunkManifest {
  index: number;
  jobId: string;
  inputCount: number;
  status: string;
  outputEntryCount: number;
  processedFileCount: number;
  skippedFileCount: number;
  manifest?: unknown;
}

export interface MergedZipManifest {
  chunks: MergedChunkManifest[];
  totalInputCount: number;
  processedFileCount: number;
  skippedFileCount: number;
}

export interface MergeChunkZipOutputsArgs {
  chunks: MergeChunkZipOutput[];
  outputPath: string;
}

interface ReadZipEntry {
  name: string;
  data: Buffer;
}

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const STORED_METHOD = 0;
const DEFLATE_METHOD = 8;

function findEndOfCentralDirectory(bytes: Buffer): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  throw new Error('Invalid ZIP archive: missing end of central directory record.');
}

function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '');
}

function parseMaybeJson(data: Buffer): unknown | undefined {
  const text = data.toString('utf8').trim();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function getNumberField(value: unknown, field: string): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? fieldValue : undefined;
}

function getManifestCount(manifest: unknown, field: 'processedFileCount' | 'skippedFileCount'): number | undefined {
  const direct = getNumberField(manifest, field);

  if (direct !== undefined) {
    return direct;
  }

  if (!manifest || typeof manifest !== 'object') {
    return undefined;
  }

  return getNumberField((manifest as Record<string, unknown>).summary, field);
}

function readZipEntries(bytes: Buffer): ReadZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const entries: ReadZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('Invalid ZIP archive: invalid central directory record.');
    }

    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const rawName = bytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    const name = normalizeEntryName(rawName);

    if (bytes.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error('Invalid ZIP archive: invalid local file record.');
    }

    const localFileNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedData = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let data: Buffer;

    if (compressionMethod === STORED_METHOD) {
      data = Buffer.from(compressedData);
    } else if (compressionMethod === DEFLATE_METHOD) {
      data = inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${compressionMethod}.`);
    }

    if (data.length !== uncompressedSize) {
      throw new Error('Invalid ZIP archive: uncompressed size mismatch.');
    }

    if (name && !name.endsWith('/')) {
      entries.push({ name, data });
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function formatChunkDirectory(index: number): string {
  return `chunk-${String(index).padStart(3, '0')}`;
}

export async function mergeChunkZipOutputs(args: MergeChunkZipOutputsArgs): Promise<MergedZipManifest> {
  const outputEntries: StoredZipEntryInput[] = [];
  const chunkManifests: MergedChunkManifest[] = [];

  for (const chunk of args.chunks) {
    const entries = readZipEntries(await readFile(chunk.zipPath));
    const chunkDirectory = formatChunkDirectory(chunk.index);
    const originalManifestEntry = entries.find((entry) => entry.name === 'manifest.json');
    const originalManifest = originalManifestEntry ? parseMaybeJson(originalManifestEntry.data) : undefined;
    const nonManifestEntryCount = entries.filter((entry) => entry.name !== 'manifest.json').length;
    const processedFileCount =
      chunk.processedFileCount ??
      getManifestCount(originalManifest, 'processedFileCount') ??
      nonManifestEntryCount;
    const skippedFileCount =
      chunk.skippedFileCount ?? getManifestCount(originalManifest, 'skippedFileCount') ?? 0;

    for (const entry of entries) {
      outputEntries.push({
        name: `${chunkDirectory}/${entry.name}`,
        data: entry.data,
      });
    }

    chunkManifests.push({
      index: chunk.index,
      jobId: chunk.jobId,
      inputCount: chunk.inputCount,
      status: chunk.status,
      outputEntryCount: nonManifestEntryCount,
      processedFileCount,
      skippedFileCount,
      ...(originalManifest !== undefined ? { manifest: originalManifest } : {}),
    });
  }

  const manifest: MergedZipManifest = {
    chunks: chunkManifests,
    totalInputCount: chunkManifests.reduce((sum, chunk) => sum + chunk.inputCount, 0),
    processedFileCount: chunkManifests.reduce((sum, chunk) => sum + chunk.processedFileCount, 0),
    skippedFileCount: chunkManifests.reduce((sum, chunk) => sum + chunk.skippedFileCount, 0),
  };

  outputEntries.push({
    name: 'manifest.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2)),
  });

  await writeFile(args.outputPath, createStoredZipArchive(outputEntries));
  return manifest;
}
