import { describe, expect, it } from 'vitest';
import { main } from '../../src/cli.js';

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
});
