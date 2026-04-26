import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { glob } from 'glob';
import { describe, expect, it } from 'vitest';

describe('glob dependency compatibility', () => {
  it('resolves glob matches with the imported promise API', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-glob-compat-'));
    const first = join(tempDir, 'one.md');
    const ignored = join(tempDir, 'ignored.txt');

    try {
      await writeFile(first, '# one');
      await writeFile(ignored, 'ignored');

      const matches = await glob(join(tempDir, '*.md'));

      expect(matches).toEqual([first]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
