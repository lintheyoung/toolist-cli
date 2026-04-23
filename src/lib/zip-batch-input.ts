import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { glob } from 'glob';

export interface CreateZipBatchInputArgs {
  inputs?: string[];
  inputGlob?: string;
  outputDir?: string;
}

export interface CreateZipBatchInputResult {
  zipPath: string;
  inputCount: number;
  cleanupPath?: string;
}

export interface StoredZipEntryInput {
  name: string;
  data: Buffer;
}

type ZipEntry = StoredZipEntryInput & {
  name: string;
  data: Buffer;
  crc32: number;
  offset: number;
};

let crcTable: Uint32Array | null = null;
const ZIP_UTF8_FILENAME_FLAG = 0x0800;

function getCrcTable(): Uint32Array {
  if (crcTable) {
    return crcTable;
  }

  crcTable = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    crcTable[index] = value >>> 0;
  }

  return crcTable;
}

function computeCrc32(data: Buffer): number {
  const table = getCrcTable();
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function buildLocalFileHeader(entry: ZipEntry): Buffer {
  const nameBytes = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(ZIP_UTF8_FILENAME_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, nameBytes, entry.data]);
}

function buildCentralDirectoryRecord(entry: ZipEntry): Buffer {
  const nameBytes = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(46);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(ZIP_UTF8_FILENAME_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(entry.crc32, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);

  return Buffer.concat([header, nameBytes]);
}

function buildEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Buffer {
  const record = Buffer.alloc(22);

  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralDirectorySize, 12);
  record.writeUInt32LE(centralDirectoryOffset, 16);
  record.writeUInt16LE(0, 20);

  return record;
}

function collectUniquePaths(args: CreateZipBatchInputArgs, globbedPaths: string[]): string[] {
  const seen = new Set<string>();
  const orderedPaths = [...(args.inputs ?? []), ...globbedPaths];

  return orderedPaths.filter((inputPath) => {
    if (!inputPath || seen.has(inputPath)) {
      return false;
    }

    seen.add(inputPath);
    return true;
  });
}

async function buildZipEntryInputs(inputPaths: string[]): Promise<StoredZipEntryInput[]> {
  const entries: StoredZipEntryInput[] = [];

  for (const inputPath of inputPaths) {
    const data = await readFile(inputPath);
    const entry: StoredZipEntryInput = {
      name: basename(inputPath),
      data,
    };

    entries.push(entry);
  }

  return entries;
}

function prepareZipEntries(entries: StoredZipEntryInput[]): ZipEntry[] {
  let offset = 0;

  return entries.map((entry) => {
    const preparedEntry: ZipEntry = {
      ...entry,
      crc32: computeCrc32(entry.data),
      offset,
    };

    offset += 30 + Buffer.byteLength(entry.name, 'utf8') + entry.data.length;
    return preparedEntry;
  });
}

export function createStoredZipArchive(entries: StoredZipEntryInput[]): Buffer {
  const preparedEntries = prepareZipEntries(entries);
  return buildZipArchive(preparedEntries);
}

function buildZipArchive(entries: ZipEntry[]): Buffer {
  const localFileRecords = entries.map((entry) => buildLocalFileHeader(entry));
  const centralDirectoryOffset = localFileRecords.reduce((sum, record) => sum + record.length, 0);
  const centralDirectoryRecords = entries.map((entry) => buildCentralDirectoryRecord(entry));
  const centralDirectorySize = centralDirectoryRecords.reduce((sum, record) => sum + record.length, 0);

  return Buffer.concat([
    ...localFileRecords,
    ...centralDirectoryRecords,
    buildEndOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset),
  ]);
}

export async function createZipBatchInput(
  args: CreateZipBatchInputArgs,
): Promise<CreateZipBatchInputResult> {
  const inputPaths = await resolveZipBatchInputPaths(args);

  if (inputPaths.length === 0) {
    throw new Error('Remove watermark batch requires at least one input.');
  }

  const cleanupPath = args.outputDir
    ? undefined
    : await mkdtemp(join(tmpdir(), 'toollist-watermark-batch-input-'));
  const outputDir = args.outputDir ?? cleanupPath!;

  try {
    await mkdir(outputDir, { recursive: true });

    const entries = await buildZipEntryInputs(inputPaths);
    const zipPath = join(outputDir, 'inputs.zip');
    const archive = createStoredZipArchive(entries);

    await writeFile(zipPath, archive);

    return {
      zipPath,
      inputCount: inputPaths.length,
      ...(cleanupPath ? { cleanupPath } : {}),
    };
  } catch (error) {
    if (cleanupPath) {
      await rm(cleanupPath, { recursive: true, force: true });
    }

    throw error;
  }
}

export async function resolveZipBatchInputPaths(args: CreateZipBatchInputArgs): Promise<string[]> {
  const globbedPaths = args.inputGlob ? await glob(args.inputGlob) : [];
  return collectUniquePaths(args, globbedPaths);
}
