import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function parsePackFilename(stdout) {
  const trimmed = stdout.trim();

  if (!trimmed) {
    throw new Error('npm pack did not return any output.');
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0]?.filename !== 'string') {
      throw new Error('npm pack JSON output did not include a filename.');
    }

    return parsed[0].filename;
  } catch (error) {
    throw new Error(`Failed to parse npm pack output: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertFileExists(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected ${label} at ${filePath}`);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'toollist-cli-pack-'));
let tarballPath;

try {
  const packOutput = run('npm', ['pack', '--json']);
  const tarballName = parsePackFilename(packOutput);
  tarballPath = join(repoRoot, tarballName);

  const installRoot = mkdtempSync(join(tempRoot, 'install-'));
  execFileSync('npm', ['init', '-y'], {
    cwd: installRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync('npm', ['install', '--ignore-scripts', tarballPath], {
    cwd: installRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const packageRoot = join(installRoot, 'node_modules', 'toolist-cli');
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const binPath = join(packageRoot, packageJson.bin.toolist.replace(/^\.\//, ''));

  assertFileExists(join(packageRoot, 'README.md'), 'packaged README');
  assertFileExists(join(packageRoot, 'LICENSE'), 'packaged LICENSE');
  assertFileExists(join(packageRoot, 'dist', 'cli.js'), 'packaged CLI entrypoint');
  assertFileExists(binPath, 'declared CLI binary');

  const helpOutput = execFileSync(process.execPath, [binPath, '--help'], {
    cwd: installRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const toolsHelpOutput = execFileSync(process.execPath, [binPath, 'tools', 'help'], {
    cwd: installRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (!helpOutput.includes('Toollist CLI') && !helpOutput.includes('toollist')) {
    throw new Error('Installed CLI did not print the root help output.');
  }

  if (!toolsHelpOutput.includes('toollist tools list')) {
    throw new Error('Installed CLI did not print the tools help output.');
  }

  process.stdout.write(`Verified packaged install smoke for ${tarballName}\n`);
} finally {
  if (tarballPath && existsSync(tarballPath)) {
    unlinkSync(tarballPath);
  }

  rmSync(tempRoot, { recursive: true, force: true });
}
