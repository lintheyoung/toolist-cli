import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { main } from '../../src/cli.js';

type CliHelpCoverageEntry = {
  command: string;
  helpArgs: string[];
  docsUrl: string;
  snapshot: string;
};

type CliHelpCoverage = {
  docsRoot: string;
  entries: CliHelpCoverageEntry[];
};

const requiredCommands = [
  'files upload',
  'image convert',
  'image resize',
  'image crop',
  'image remove-watermark',
  'image remove-background',
  'document docx-to-markdown',
  'markdown upload-images',
  'twitter watch',
];

function readCoverage(): CliHelpCoverage {
  return JSON.parse(
    readFileSync(new URL('../../docs/cli-help-coverage.json', import.meta.url), 'utf8'),
  ) as CliHelpCoverage;
}

function readSnapshot(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

function normalizeHelp(help: string): string {
  return help
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

async function runHelp(args: string[]) {
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

describe('CLI help documentation coverage', () => {
  it('tracks docs coverage for core command help surfaces', async () => {
    const coverage = readCoverage();

    expect(coverage.docsRoot).toBe('https://tooli.st/docs');

    const entriesByCommand = new Map(
      coverage.entries.map((entry) => [entry.command, entry]),
    );

    expect(entriesByCommand.size).toBe(coverage.entries.length);

    for (const command of requiredCommands) {
      const entry = entriesByCommand.get(command);

      expect(entry, `${command} should be listed in docs coverage`).toBeDefined();
      expect(
        entry?.docsUrl === coverage.docsRoot ||
          entry?.docsUrl.startsWith(`${coverage.docsRoot}/`),
      ).toBe(true);
      expect(entry?.snapshot).toMatch(/^docs\/generated\/cli-help\/.+\.txt$/);

      const result = await runHelp(entry?.helpArgs ?? []);

      expect(result.exitCode, `${command} help should exit successfully`).toBe(0);
      expect(result.stderr, `${command} help should not write stderr`).toBe('');
      expect(normalizeHelp(result.stdout)).toBe(normalizeHelp(readSnapshot(entry?.snapshot ?? '')));
    }
  });
});
