import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  name: string;
  bin?: string | Record<string, string>;
  repository?: { type?: string; url?: string };
  homepage?: string;
  bugs?: { url?: string };
};

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

describe('package metadata', () => {
  it('uses the toolist-cli package identity', () => {
    expect(packageJson.name).toBe('toolist-cli');
    expect(packageJson.bin).toEqual({
      toolist: './dist/cli.js',
    });
    expect(packageJson.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/lintheyoung/toolist-cli.git',
    });
    expect(packageJson.homepage).toBe('https://github.com/lintheyoung/toolist-cli#readme');
    expect(packageJson.bugs).toEqual({
      url: 'https://github.com/lintheyoung/toolist-cli/issues',
    });
  });

  it('keeps the CLI command examples as toolist', () => {
    expect(readme).toContain('npm install -g toolist-cli');
    expect(readme).toContain('toolist --help');
    expect(readme).toContain('npx toolist-cli@latest --help');
  });
});
