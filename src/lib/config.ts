import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface ToollistConfig {
  baseUrl: string;
  accessToken?: string;
}

function getDefaultConfigPath(): string {
  if (platform() === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    return join(appData, 'toollist', 'config.json');
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(configHome, 'toollist', 'config.json');
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function loadConfig(pathOverride?: string): Promise<ToollistConfig | null> {
  const configPath = pathOverride ?? getDefaultConfigPath();

  try {
    const contents = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(contents) as Partial<ToollistConfig>;

    if (typeof parsed.baseUrl !== 'string') {
      return null;
    }

    const config: ToollistConfig = {
      baseUrl: parsed.baseUrl,
    };

    if (typeof parsed.accessToken === 'string') {
      config.accessToken = parsed.accessToken;
    }

    return config;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function saveConfig(config: ToollistConfig, pathOverride?: string): Promise<void> {
  const configPath = pathOverride ?? getDefaultConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  const tempPath = join(dirname(configPath), `.tmp-${randomUUID()}`);
  const contents = `${JSON.stringify(config, null, 2)}\n`;

  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, configPath);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup failures; the original error is the important one.
    }

    throw error;
  }
}

export async function clearConfig(pathOverride?: string): Promise<void> {
  const configPath = pathOverride ?? getDefaultConfigPath();

  try {
    await unlink(configPath);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}
