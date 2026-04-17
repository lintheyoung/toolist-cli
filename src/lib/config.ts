import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_ENVIRONMENT,
  inferEnvironmentFromBaseUrl,
  type ToolistEnvironment,
} from './environments.js';

export interface ToollistActiveProfile {
  baseUrl: string;
  accessToken?: string;
}

export interface ToollistProfile {
  environment: ToolistEnvironment;
  baseUrl: string;
  accessToken?: string;
}

export interface ToollistConfig {
  activeEnvironment: ToolistEnvironment;
  activeProfile?: ToollistActiveProfile;
  profiles: Partial<Record<ToolistEnvironment, ToollistProfile>>;
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

function isEnvironment(value: unknown): value is ToolistEnvironment {
  return value === 'prod' || value === 'test' || value === 'dev';
}

function isActiveProfile(value: unknown): value is ToollistActiveProfile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ToollistActiveProfile).baseUrl === 'string' &&
    (
      typeof (value as ToollistActiveProfile).accessToken === 'undefined' ||
      typeof (value as ToollistActiveProfile).accessToken === 'string'
    )
  );
}

function isProfile(value: unknown): value is ToollistProfile {
  return isActiveProfile(value) && isEnvironment((value as ToollistProfile).environment);
}

function migrateLegacyConfig(parsed: Record<string, unknown>): ToollistConfig | null {
  if (typeof parsed.baseUrl !== 'string') {
    return null;
  }

  const activeProfile: ToollistActiveProfile = {
    baseUrl: parsed.baseUrl,
    accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : undefined,
  };
  const environment = inferEnvironmentFromBaseUrl(parsed.baseUrl);

  if (!environment) {
    return {
      activeEnvironment: DEFAULT_ENVIRONMENT,
      activeProfile,
      profiles: {},
    };
  }

  return {
    activeEnvironment: environment,
    profiles: {
      [environment]: {
        environment,
        ...activeProfile,
      },
    },
  };
}

function normalizeConfig(parsed: unknown): ToollistConfig | null {
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const migratedConfig = migrateLegacyConfig(record);

  if (migratedConfig) {
    return migratedConfig;
  }

  const profiles: Partial<Record<ToolistEnvironment, ToollistProfile>> = {};
  const rawProfiles = record.profiles;
  const activeProfile = isActiveProfile(record.activeProfile)
    ? record.activeProfile
    : undefined;

  if (typeof rawProfiles === 'object' && rawProfiles !== null) {
    for (const environment of ['prod', 'test', 'dev'] as const) {
      const profile = (rawProfiles as Record<string, unknown>)[environment];

      if (isProfile(profile)) {
        profiles[environment] = profile;
      }
    }
  }

  return {
    activeEnvironment: isEnvironment(record.activeEnvironment)
      ? record.activeEnvironment
      : DEFAULT_ENVIRONMENT,
    ...(activeProfile ? { activeProfile } : {}),
    profiles,
  };
}

export async function loadConfig(pathOverride?: string): Promise<ToollistConfig | null> {
  const configPath = pathOverride ?? getDefaultConfigPath();

  try {
    const contents = await readFile(configPath, 'utf8');
    return normalizeConfig(JSON.parse(contents));
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

export function getProfileForEnvironment(
  config: ToollistConfig | null,
  environment: ToolistEnvironment,
): ToollistProfile | null {
  return config?.profiles?.[environment] ?? null;
}

export function getActiveProfile(
  config: ToollistConfig | null,
): ToollistActiveProfile | ToollistProfile | null {
  return config?.activeProfile ?? null;
}
