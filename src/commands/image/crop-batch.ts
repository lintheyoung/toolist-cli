import { glob } from 'node:fs/promises';

import { runBatchCommand, type BatchRunResult } from '../batch/run.js';
import type { BatchManifest, BatchManifestDefaults } from '../../lib/batch-manifest.js';
import { buildHomogeneousImageBatchManifest } from './homogeneous-batch-manifest.js';

export interface ImageCropBatchCommandArgs {
  inputs?: string[];
  inputGlob?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  to?: string;
  quality?: number;
  concurrency?: number;
  wait?: boolean;
  outputDir?: string;
  resume?: boolean;
  baseUrl: string;
  token: string;
  configPath?: string;
}

export interface CropBatchManifestArgs {
  inputs?: string[];
  inputGlob?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  to?: string;
  quality?: number;
  concurrency?: number;
  wait?: boolean;
  outputDir?: string;
  baseUrl?: string;
}

export interface ImageCropBatchDependencies {
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

function createDefaultDependencies(): ImageCropBatchDependencies {
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

export async function buildCropBatchManifest(
  args: CropBatchManifestArgs,
  dependencies: Partial<Pick<ImageCropBatchDependencies, 'glob'>> = {},
): Promise<BatchManifest> {
  const deps = {
    glob,
    ...dependencies,
  };

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
      toolName: 'image.crop',
      idPrefix: 'crop',
      buildInput: async () => ({
        x: args.x,
        y: args.y,
        width: args.width,
        height: args.height,
        ...(targetMimeType ? { target_mime_type: targetMimeType } : {}),
        ...(args.quality !== undefined ? { quality: args.quality } : {}),
      }),
    },
    {
      glob: deps.glob,
    },
  );
}

export async function imageCropBatchCommand(
  args: ImageCropBatchCommandArgs,
  dependencies: Partial<ImageCropBatchDependencies> = {},
): Promise<BatchRunResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const manifest = await buildCropBatchManifest(args, {
    glob: deps.glob,
  });

  return deps.runBatchCommand(
    {
      manifestPath: '<image-crop-batch>',
      resume: args.resume ?? false,
      concurrency: args.concurrency,
      outputDir: args.outputDir,
      baseUrl: args.baseUrl,
      token: args.token,
      configPath: args.configPath,
    },
    {
      readBatchManifest: async () => manifest,
    },
  );
}
