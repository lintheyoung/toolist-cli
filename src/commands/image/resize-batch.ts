import { glob } from 'glob';

import { runBatchCommand, type BatchRunResult } from '../batch/run.js';
import type { BatchManifest, BatchManifestDefaults } from '../../lib/batch-manifest.js';
import { buildHomogeneousImageBatchManifest } from './homogeneous-batch-manifest.js';
import type { ToolistEnvironment } from '../../lib/environments.js';
import { withRetryHandler, type RetryHandler } from '../../lib/retry.js';

export interface ImageResizeBatchCommandArgs {
  inputs?: string[];
  inputGlob?: string;
  width?: number;
  height?: number;
  to?: string;
  quality?: number;
  concurrency?: number;
  wait?: boolean;
  outputDir?: string;
  resume?: boolean;
  env?: ToolistEnvironment;
  baseUrl: string;
  token: string;
  configPath?: string;
  onRetry?: RetryHandler;
}

export interface ResizeBatchManifestArgs {
  inputs?: string[];
  inputGlob?: string;
  width?: number;
  height?: number;
  to?: string;
  quality?: number;
  concurrency?: number;
  wait?: boolean;
  outputDir?: string;
  baseUrl?: string;
}

export interface ImageResizeBatchDependencies {
  glob: typeof glob;
  runBatchCommand: typeof runBatchCommand;
}

const TARGET_MIME_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function createDefaultDependencies(): ImageResizeBatchDependencies {
  return {
    glob,
    runBatchCommand,
  };
}

function normalizeTargetMimeType(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error('Missing required option: --to');
  }

  if (normalized.includes('/')) {
    return normalized;
  }

  const mimeType = TARGET_MIME_TYPES[normalized];

  if (!mimeType) {
    throw new Error(`Unsupported output format: ${value}`);
  }

  return mimeType;
}

export async function buildResizeBatchManifest(
  args: ResizeBatchManifestArgs,
  dependencies: Partial<Pick<ImageResizeBatchDependencies, 'glob'>> = {},
): Promise<BatchManifest> {
  const deps = {
    glob,
    ...dependencies,
  };

  if (args.width === undefined && args.height === undefined) {
    throw new Error('Resize batch requires at least one of --width or --height.');
  }

  const targetMimeType = args.to ? normalizeTargetMimeType(args.to) : undefined;
  const defaults: BatchManifestDefaults = {
    ...(args.baseUrl ? { base_url: args.baseUrl } : {}),
    ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
    ...(args.wait || args.outputDir ? { wait: true } : {}),
    ...(args.outputDir
      ? {
          download_outputs: true,
          output_dir: args.outputDir,
        }
      : {}),
  };

  return buildHomogeneousImageBatchManifest(
    {
      inputs: args.inputs,
      inputGlob: args.inputGlob,
      defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
      toolName: 'image.resize',
      idPrefix: 'resize',
      buildInput: async () => ({
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
        ...(targetMimeType ? { target_mime_type: targetMimeType } : {}),
        ...(args.quality !== undefined ? { quality: args.quality } : {}),
      }),
    },
    {
      glob: deps.glob,
    },
  );
}

export async function imageResizeBatchCommand(
  args: ImageResizeBatchCommandArgs,
  dependencies: Partial<ImageResizeBatchDependencies> = {},
): Promise<BatchRunResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const manifest = await buildResizeBatchManifest(args, {
    glob: deps.glob,
  });

  return deps.runBatchCommand(
    withRetryHandler({
      manifestPath: '<image-resize-batch>',
      resume: args.resume ?? false,
      concurrency: args.concurrency,
      outputDir: args.outputDir,
      baseUrl: args.baseUrl,
      token: args.token,
      configPath: args.configPath,
      onRetry: args.onRetry,
    }, args.onRetry),
    {
      readBatchManifest: async () => manifest,
    },
  );
}
