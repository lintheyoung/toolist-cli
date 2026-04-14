import { describe, expect, it } from 'vitest';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

describe('runWithConcurrency', () => {
  it('runs no more than the configured concurrency at once', async () => {
    const gate = createDeferred();
    let running = 0;
    let maxRunning = 0;

    const { runWithConcurrency } = await import('../../src/lib/batch-worker-pool.js');

    const resultPromise = runWithConcurrency({
      items: [1, 2, 3, 4],
      concurrency: 2,
      worker: async (item: number) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);

        if (item <= 2) {
          await gate.promise;
        }

        running -= 1;
        return item * 2;
      },
    });

    gate.resolve();

    await expect(resultPromise).resolves.toEqual([2, 4, 6, 8]);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('collects results in input order', async () => {
    const { runWithConcurrency } = await import('../../src/lib/batch-worker-pool.js');

    const results = await runWithConcurrency({
      items: ['a', 'b', 'c'],
      concurrency: 2,
      worker: async (item, index) => {
        await new Promise((resolve) => {
          setTimeout(resolve, item === 'a' ? 30 : item === 'b' ? 10 : 0);
        });

        return { id: item, index };
      },
    });

    expect(results.map((result) => result.id)).toEqual(['a', 'b', 'c']);
    expect(results.map((result) => result.index)).toEqual([0, 1, 2]);
  });
});
