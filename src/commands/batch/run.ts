import { createHash } from 'node:crypto';

import type { BatchManifest, BatchManifestDefaults, BatchManifestItem } from '../../lib/batch-manifest.js';
import { readBatchManifest } from '../../lib/batch-manifest.js';
import {
  getBatchStatePath,
  loadBatchState,
  saveBatchState,
  validateResumeState,
  type BatchItemState,
  type BatchState,
} from '../../lib/batch-state.js';
import { runWithConcurrency } from '../../lib/batch-worker-pool.js';
import { runBatchItem } from '../../lib/batch-item-runner.js';
import { withRetryHandler, type RetryHandler } from '../../lib/retry.js';

export type BatchRunSummary = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export type BatchRunResult = {
  batch_id: string;
  summary: BatchRunSummary;
  items: BatchItemState[];
};

export interface RunBatchCommandArgs {
  manifestPath: string;
  resume?: boolean;
  concurrency?: number;
  outputDir?: string;
  baseUrl: string;
  token: string;
  configPath?: string;
  onRetry?: RetryHandler;
}

export interface RunBatchCommandDependencies {
  readBatchManifest: typeof readBatchManifest;
  getBatchStatePath: typeof getBatchStatePath;
  loadBatchState: typeof loadBatchState;
  saveBatchState: typeof saveBatchState;
  validateResumeState: typeof validateResumeState;
  runBatchItem: typeof runBatchItem;
  runWithConcurrency: typeof runWithConcurrency;
}

function createDefaultDependencies(): RunBatchCommandDependencies {
  return {
    readBatchManifest,
    getBatchStatePath,
    loadBatchState,
    saveBatchState,
    validateResumeState,
    runBatchItem,
    runWithConcurrency,
  };
}

function computeManifestFingerprint(manifest: BatchManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

function createBatchId(manifestFingerprint: string): string {
  return `batch_${manifestFingerprint.slice(0, 12)}`;
}

function isTerminalStatus(status: BatchItemState['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'skipped';
}

function createInitialBatchState(args: {
  batchId: string;
  manifestFingerprint: string;
  baseUrl: string;
  manifest: BatchManifest;
  createdAt?: string;
}): BatchState {
  const items: BatchState['items'] = {};

  for (const item of args.manifest.items) {
    items[item.id] = {
      id: item.id,
      status: 'pending',
    };
  }

  return {
    batch_id: args.batchId,
    manifest_fingerprint: args.manifestFingerprint,
    base_url: args.baseUrl,
    created_at: args.createdAt ?? new Date().toISOString(),
    items,
  };
}

function mergeInitialState(args: {
  batchId: string;
  manifestFingerprint: string;
  baseUrl: string;
  manifest: BatchManifest;
  existingState?: BatchState | null;
}): BatchState {
  if (!args.existingState) {
    return createInitialBatchState({
      batchId: args.batchId,
      manifestFingerprint: args.manifestFingerprint,
      baseUrl: args.baseUrl,
      manifest: args.manifest,
    });
  }

  const merged: BatchState = {
    ...args.existingState,
    batch_id: args.existingState.batch_id,
    manifest_fingerprint: args.existingState.manifest_fingerprint,
    base_url: args.existingState.base_url,
    created_at: args.existingState.created_at,
    items: {
      ...args.existingState.items,
    },
  };

  for (const item of args.manifest.items) {
    if (!merged.items[item.id]) {
      merged.items[item.id] = {
        id: item.id,
        status: 'pending',
      };
    }
  }

  return merged;
}

function buildEffectiveDefaults(
  manifestDefaults: BatchManifestDefaults | undefined,
  args: Pick<RunBatchCommandArgs, 'concurrency' | 'outputDir'>,
): BatchManifestDefaults | undefined {
  const defaults: BatchManifestDefaults = {
    ...(manifestDefaults ?? {}),
  };

  if (args.concurrency !== undefined) {
    defaults.concurrency = args.concurrency;
  }

  if (args.outputDir !== undefined) {
    defaults.output_dir = args.outputDir;
  }

  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

function summarizeItems(items: BatchItemState[]): BatchRunSummary {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of items) {
    if (item.status === 'succeeded') {
      succeeded += 1;
      continue;
    }

    if (item.status === 'failed') {
      failed += 1;
      continue;
    }

    if (item.status === 'skipped') {
      skipped += 1;
    }
  }

  return {
    total: items.length,
    succeeded,
    failed,
    skipped,
  };
}

export async function runBatchCommand(
  args: RunBatchCommandArgs,
  dependencies: Partial<RunBatchCommandDependencies> = {},
): Promise<BatchRunResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const manifest = await deps.readBatchManifest(args.manifestPath);
  const manifestFingerprint = computeManifestFingerprint(manifest);
  const batchId = createBatchId(manifestFingerprint);
  const statePath = deps.getBatchStatePath(batchId);
  const existingState = args.resume ? await deps.loadBatchState(statePath) : null;

  if (existingState) {
    deps.validateResumeState({
      state: existingState,
      manifestFingerprint,
      baseUrl: args.baseUrl,
    });
  }

  const state = mergeInitialState({
    batchId,
    manifestFingerprint,
    baseUrl: args.baseUrl,
    manifest,
    existingState,
  });

  const effectiveDefaults = buildEffectiveDefaults(manifest.defaults, {
    concurrency: args.concurrency,
    outputDir: args.outputDir,
  });

  await deps.saveBatchState(statePath, state);

  const itemsToRun = manifest.items.filter((item) => !isTerminalStatus(state.items[item.id]?.status ?? 'pending'));

  const processedItems = await deps.runWithConcurrency({
    items: itemsToRun,
    concurrency: Math.max(1, Math.floor(effectiveDefaults?.concurrency ?? 1)),
    worker: async (item: BatchManifestItem) =>
      deps.runBatchItem(
        withRetryHandler({
          item,
          defaults: effectiveDefaults,
          credentials: {
            baseUrl: args.baseUrl,
            token: args.token,
          },
          state,
          statePath,
          onRetry: args.onRetry,
        }, args.onRetry),
      ),
  });

  for (const item of processedItems) {
    state.items[item.id] = {
      ...(state.items[item.id] ?? { id: item.id, status: 'pending' }),
      ...item,
      id: item.id,
    };
  }

  await deps.saveBatchState(statePath, state);

  const outputItems = manifest.items.map((item) => {
    const itemState = state.items[item.id];

    if (!itemState) {
      return {
        id: item.id,
        status: 'pending' as const,
      };
    }

    if (args.resume && isTerminalStatus(itemState.status)) {
      return {
        ...itemState,
        status: 'skipped' as const,
      };
    }

    return { ...itemState };
  });

  return {
    batch_id: batchId,
    summary: summarizeItems(outputItems),
    items: outputItems,
  };
}
