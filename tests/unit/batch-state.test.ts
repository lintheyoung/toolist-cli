import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('batch state helpers', () => {
  it('creates a deterministic batch state path from a batch id', async () => {
    const { getBatchStatePath } = await import('../../src/lib/batch-state.js');

    const path = getBatchStatePath('batch_123');

    expect(path).toContain('.toollist-batch');
    expect(dirname(path)).toBe(join(process.cwd(), '.toollist-batch'));
    expect(basename(path)).toBe('batch_123.json');
  });

  it('writes and reloads batch state JSON', async () => {
    const { loadBatchState, saveBatchState } = await import('../../src/lib/batch-state.js');
    const stateDir = await mkdtemp(join(tmpdir(), 'toollist-batch-state-'));
    const statePath = join(stateDir, 'batch_123.json');
    const state = {
      batch_id: 'batch_123',
      manifest_fingerprint: 'manifest_fp_123',
      base_url: 'https://api.example.com',
      workspace_id: 77,
      created_at: '2026-04-14T00:00:00.000Z',
      items: {
        'item-1': {
          id: 'item-1',
          status: 'pending' as const,
        },
      },
    };

    await saveBatchState(statePath, state);

    expect(await loadBatchState(statePath)).toEqual(state);

    await rm(stateDir, { recursive: true, force: true });
  });

  it('rejects resume when manifest fingerprints do not match', async () => {
    const { validateResumeState } = await import('../../src/lib/batch-state.js');

    expect(() =>
      validateResumeState({
        state: {
          batch_id: 'batch_123',
          manifest_fingerprint: 'manifest_fp_old',
          base_url: 'https://api.example.com',
          workspace_id: 77,
          created_at: '2026-04-14T00:00:00.000Z',
          items: {},
        },
        manifestFingerprint: 'manifest_fp_new',
        baseUrl: 'https://api.example.com',
        workspaceId: 77,
      }),
    ).toThrow(/manifest/i);
  });

  it('rejects corrupted batch state items when loading from disk', async () => {
    const { loadBatchState } = await import('../../src/lib/batch-state.js');
    const stateDir = await mkdtemp(join(tmpdir(), 'toollist-batch-state-'));
    const statePath = join(stateDir, 'batch_123.json');

    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        statePath,
        JSON.stringify({
          batch_id: 'batch_123',
          manifest_fingerprint: 'manifest_fp_123',
          created_at: '2026-04-14T00:00:00.000Z',
          items: {
            'item-1': {
              id: 123,
              status: 'pending',
            },
          },
        }),
        'utf8',
      ),
    );

    await expect(loadBatchState(statePath)).rejects.toThrow(/Invalid batch state file/i);

    await rm(stateDir, { recursive: true, force: true });
  });
});
