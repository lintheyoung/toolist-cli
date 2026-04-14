import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type BatchItemState = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  uploaded_file_id?: string;
  job_id?: string;
  output_file_id?: string;
  output_path?: string;
  error?: {
    code?: string;
    message: string;
  };
};

export type BatchState = {
  batch_id: string;
  manifest_fingerprint: string;
  base_url?: string;
  workspace_id?: number;
  created_at: string;
  items: Record<string, BatchItemState>;
};

function getBatchStateDirectory(): string {
  return join(process.cwd(), '.toollist-batch');
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isBatchItemState(value: unknown): value is BatchItemState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<BatchItemState>;

  if (typeof candidate.id !== 'string') {
    return false;
  }

  if (
    candidate.status !== 'pending' &&
    candidate.status !== 'running' &&
    candidate.status !== 'succeeded' &&
    candidate.status !== 'failed' &&
    candidate.status !== 'skipped'
  ) {
    return false;
  }

  const optionalStringKeys = [
    'uploaded_file_id',
    'job_id',
    'output_file_id',
    'output_path',
  ] as const;

  for (const key of optionalStringKeys) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'string') {
      return false;
    }
  }

  if (candidate.error !== undefined) {
    if (typeof candidate.error !== 'object' || candidate.error === null) {
      return false;
    }

    const error = candidate.error as {
      code?: unknown;
      message?: unknown;
    };

    if (error.code !== undefined && typeof error.code !== 'string') {
      return false;
    }

    if (typeof error.message !== 'string') {
      return false;
    }
  }

  return true;
}

function isBatchState(value: unknown): value is BatchState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<BatchState>;

  return (
    typeof candidate.batch_id === 'string' &&
    typeof candidate.manifest_fingerprint === 'string' &&
    (candidate.base_url === undefined || typeof candidate.base_url === 'string') &&
    (candidate.workspace_id === undefined || typeof candidate.workspace_id === 'number') &&
    typeof candidate.created_at === 'string' &&
    typeof candidate.items === 'object' &&
    candidate.items !== null &&
    !Array.isArray(candidate.items) &&
    Object.values(candidate.items).every(isBatchItemState)
  );
}

export function getBatchStatePath(batchId: string): string {
  return join(getBatchStateDirectory(), `${batchId}.json`);
}

export async function saveBatchState(path: string, state: BatchState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = join(dirname(path), `.tmp-${randomUUID()}`);
  const contents = `${JSON.stringify(state, null, 2)}\n`;

  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, path);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup failures; the original error is the important one.
    }

    throw error;
  }
}

export async function loadBatchState(path: string): Promise<BatchState | null> {
  try {
    const contents = await readFile(path, 'utf8');
    const parsed = JSON.parse(contents) as unknown;

    if (!isBatchState(parsed)) {
      throw new Error('Invalid batch state file.');
    }

    return parsed;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export function validateResumeState(args: {
  state: BatchState;
  manifestFingerprint: string;
  baseUrl?: string;
  workspaceId?: number;
}): void {
  if (args.state.manifest_fingerprint !== args.manifestFingerprint) {
    throw new Error('Cannot resume batch: manifest fingerprint does not match saved state.');
  }

  if (args.state.base_url !== args.baseUrl) {
    throw new Error('Cannot resume batch: base URL does not match saved state.');
  }

  if (args.state.workspace_id !== args.workspaceId) {
    throw new Error('Cannot resume batch: workspace context does not match saved state.');
  }
}
