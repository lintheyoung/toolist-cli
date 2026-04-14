import { readFile } from 'node:fs/promises';

export type BatchManifestToolName =
  | 'image.convert_format'
  | 'image.resize'
  | 'image.crop';

export type BatchManifestDefaults = {
  base_url?: string;
  concurrency?: number;
  wait?: boolean;
  download_outputs?: boolean;
  output_dir?: string;
};

export type BatchManifestItem = {
  id: string;
  tool_name: BatchManifestToolName;
  input_path?: string;
  input_file_id?: string;
  input: Record<string, unknown>;
};

export type BatchManifest = {
  version: 1;
  defaults?: BatchManifestDefaults;
  items: BatchManifestItem[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function parseDefaults(value: unknown): BatchManifestDefaults | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new Error('Batch manifest defaults must be an object.');
  }

  const defaults: BatchManifestDefaults = {};

  if ('base_url' in value) {
    const baseUrl = asString(value.base_url);

    if (!baseUrl) {
      throw new Error('Batch manifest defaults.base_url must be a non-empty string.');
    }

    defaults.base_url = baseUrl;
  }

  if ('concurrency' in value) {
    const concurrency = asPositiveInteger(value.concurrency);

    if (concurrency === null) {
      throw new Error('Batch manifest defaults.concurrency must be a positive integer.');
    }

    defaults.concurrency = concurrency;
  }

  if ('wait' in value) {
    const wait = asBoolean(value.wait);

    if (wait === null) {
      throw new Error('Batch manifest defaults.wait must be a boolean.');
    }

    defaults.wait = wait;
  }

  if ('download_outputs' in value) {
    const downloadOutputs = asBoolean(value.download_outputs);

    if (downloadOutputs === null) {
      throw new Error('Batch manifest defaults.download_outputs must be a boolean.');
    }

    defaults.download_outputs = downloadOutputs;
  }

  if ('output_dir' in value) {
    const outputDir = asString(value.output_dir);

    if (!outputDir) {
      throw new Error('Batch manifest defaults.output_dir must be a non-empty string.');
    }

    defaults.output_dir = outputDir;
  }

  return defaults;
}

function parseItem(value: unknown, index: number): BatchManifestItem {
  if (!isPlainObject(value)) {
    throw new Error(`Batch manifest item ${index} must be an object.`);
  }

  const id = asString(value.id);

  if (!id) {
    throw new Error(`Batch manifest item ${index} is missing id.`);
  }

  const toolName = asString(value.tool_name);

  if (!toolName) {
    throw new Error(`Batch manifest item ${index} is missing tool_name.`);
  }

  if (toolName !== 'image.convert_format' && toolName !== 'image.resize' && toolName !== 'image.crop') {
    throw new Error(`Batch manifest item ${index} has unsupported tool_name "${toolName}".`);
  }

  if (!('input' in value) || !isPlainObject(value.input)) {
    throw new Error(`Batch manifest item ${index} must include input.`);
  }

  const inputPath = 'input_path' in value ? asString(value.input_path) : null;
  const inputFileId = 'input_file_id' in value ? asString(value.input_file_id) : null;

  if ('input_path' in value && !inputPath) {
    throw new Error(`Batch manifest item ${index} input_path must be a non-empty string.`);
  }

  if ('input_file_id' in value && !inputFileId) {
    throw new Error(`Batch manifest item ${index} input_file_id must be a non-empty string.`);
  }

  if (!inputPath && !inputFileId) {
    throw new Error(
      `Batch manifest item ${index} must define input_path or input_file_id.`,
    );
  }

  const item: BatchManifestItem = {
    id,
    tool_name: toolName,
    input: value.input as Record<string, unknown>,
  };

  if (inputPath) {
    item.input_path = inputPath;
  }

  if (inputFileId) {
    item.input_file_id = inputFileId;
  }

  return item;
}

export function parseBatchManifest(text: string): BatchManifest {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Batch manifest must be valid JSON.');
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Batch manifest must be a JSON object.');
  }

  if (parsed.version !== 1) {
    throw new Error('Batch manifest version must be 1.');
  }

  if (!('items' in parsed) || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('Batch manifest must include an items array with at least one item.');
  }

  const defaults = parseDefaults(parsed.defaults);
  const items = parsed.items.map((item, index) => parseItem(item, index));

  return defaults ? { version: 1, defaults, items } : { version: 1, items };
}

export async function readBatchManifest(path: string): Promise<BatchManifest> {
  const text = await readFile(path, 'utf8');
  return parseBatchManifest(text);
}
