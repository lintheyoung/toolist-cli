import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const cliPath = join(repoRoot, 'dist', 'cli.js');

const token = process.env.TOOLLIST_TEST_TOKEN;
const environment = process.env.TOOLLIST_TEST_ENV || 'test';
const baseUrl = process.env.TOOLLIST_TEST_BASE_URL || undefined;
const defaultBaseUrl = environment === 'prod'
  ? 'https://tooli.st'
  : environment === 'test'
    ? 'https://test.tooli.st'
    : 'http://localhost:3024';

if (!token) {
  throw new Error('Missing TOOLLIST_TEST_TOKEN for hosted test smoke.');
}

function runCli(args) {
  const finalArgs = [cliPath, ...args, '--env', environment, '--json'];

  if (baseUrl) {
    finalArgs.push('--base-url', baseUrl);
  }

  const stdout = execFileSync(process.execPath, finalArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`Failed to parse CLI JSON output for \`${args.join(' ')}\`: ${error instanceof Error ? error.message : String(error)}\n${stdout}`);
  }
}

function assertTruthy(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), 'toollist-cli-hosted-smoke-'));
const configPath = join(tempRoot, 'config.json');

writeFileSync(configPath, `${JSON.stringify({
  activeEnvironment: environment,
  profiles: {
    [environment]: {
      environment,
      baseUrl: baseUrl ?? defaultBaseUrl,
      accessToken: token,
    },
  },
}, null, 2)}\n`, 'utf8');

try {
  const configArgs = ['--config-path', configPath];
  const whoami = runCli(['whoami', ...configArgs]);
  assertTruthy(whoami.user?.id, 'Hosted smoke expected whoami.user.id');
  assertTruthy(whoami.user?.email, 'Hosted smoke expected whoami.user.email');
  assertTruthy(whoami.workspace?.id, 'Hosted smoke expected whoami.workspace.id');

  const tools = runCli(['tools', 'list', ...configArgs]);
  assertTruthy(Array.isArray(tools.tools), 'Hosted smoke expected tools.tools to be an array');
  assertTruthy(tools.tools.length > 0, 'Hosted smoke expected at least one hosted tool');

  const samplePath = join(tempRoot, 'release-smoke.png');
  writeFileSync(
    samplePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9lJawAAAAASUVORK5CYII=',
      'base64',
    ),
  );

  const upload = runCli(['files', 'upload', '--input', samplePath, '--public', ...configArgs]);
  assertTruthy(upload.file_id, 'Hosted smoke expected upload.file_id');
  assertTruthy(upload.upload_url, 'Hosted smoke expected upload.upload_url');
  assertTruthy(upload.public_url, 'Hosted smoke expected upload.public_url');
  assertTruthy(upload.file?.status, 'Hosted smoke expected upload.file.status');

  process.stdout.write(`Hosted ${environment} smoke passed for ${whoami.user.email}\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
