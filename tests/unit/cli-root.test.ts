import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDirectExecution, main } from '../../src/cli.js';

async function runCli(args: string[]) {
  let stdout = '';
  let stderr = '';

  const exitCode = await main(args, {
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });

  return { exitCode, stdout, stderr };
}

describe('root command', () => {
  it('prints help for the root command', async () => {
    const result = await runCli(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('login');
    expect(result.stdout).toContain('tools');
  });

  it('treats a symlinked global install path as direct execution', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toolist-cli-entry-'));
    const symlinkPath = join(tempDir, 'toolist');
    const modulePath = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

    await symlink(modulePath, symlinkPath);

    expect(
      isDirectExecution(symlinkPath, modulePath)
    ).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });
});
