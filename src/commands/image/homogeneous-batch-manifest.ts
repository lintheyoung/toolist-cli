import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  BatchManifest,
  BatchManifestDefaults,
  BatchManifestToolName,
} from '../../lib/batch-manifest.js';

export interface HomogeneousBatchManifestArgs<TInput extends Record<string, unknown>> {
  inputs?: string[];
  inputGlob?: string;
  defaults?: BatchManifestDefaults;
  toolName: BatchManifestToolName;
  idPrefix: string;
  buildInput: (inputPath: string, index: number) => TInput | Promise<TInput>;
}

export interface HomogeneousBatchManifestDependencies {
  glob: typeof glob;
  resolvePath: typeof resolve;
}

function createDefaultDependencies(): HomogeneousBatchManifestDependencies {
  return {
    glob,
    resolvePath: resolve,
  };
}

async function expandGlob(
  pattern: string,
  globFn: typeof glob,
  resolvePath: typeof resolve,
): Promise<string[]> {
  const matches: string[] = [];

  for await (const match of globFn(pattern)) {
    matches.push(resolvePath(match));
  }

  return matches;
}

function toDeterministicItemId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

export async function buildHomogeneousImageBatchManifest<TInput extends Record<string, unknown>>(
  args: HomogeneousBatchManifestArgs<TInput>,
  dependencies: Partial<HomogeneousBatchManifestDependencies> = {},
): Promise<BatchManifest> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const resolvedInputs = (args.inputs ?? []).map((input) => deps.resolvePath(input));
  const globInputs = args.inputGlob ? await expandGlob(args.inputGlob, deps.glob, deps.resolvePath) : [];
  const dedupedInputs = [...new Set([...resolvedInputs, ...globInputs])];

  if (dedupedInputs.length === 0) {
    throw new Error('Batch manifest requires at least one input file.');
  }

  const items = await Promise.all(
    dedupedInputs.map(async (inputPath, index) => ({
      id: toDeterministicItemId(args.idPrefix, index),
      tool_name: args.toolName,
      input_path: inputPath,
      input: await args.buildInput(inputPath, index),
    })),
  );

  return {
    version: 1,
    ...(args.defaults && Object.keys(args.defaults).length > 0 ? { defaults: args.defaults } : {}),
    items,
  };
}
