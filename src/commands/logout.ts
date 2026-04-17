import {
  getActiveProfile,
  clearConfig,
  getProfileForEnvironment,
  loadConfig,
  saveConfig,
  type ToollistConfig,
} from '../lib/config.js';
import {
  DEFAULT_ENVIRONMENT,
  resolveEnvironmentName,
  type ToolistEnvironment,
} from '../lib/environments.js';

export interface LogoutCommandArgs {
  configPath?: string;
  env?: ToolistEnvironment;
}

export interface LogoutDependencies {
  clearConfig: typeof clearConfig;
  loadConfig: typeof loadConfig;
  saveConfig: typeof saveConfig;
}

export interface LogoutCommandResult {
  loggedOut: true;
}

function createDefaultDependencies(): LogoutDependencies {
  return {
    clearConfig,
    loadConfig,
    saveConfig,
  };
}

function resolveSelectedEnvironment(
  requestedEnvironment: ToolistEnvironment | undefined,
  config: ToollistConfig | null,
): ToolistEnvironment {
  if (requestedEnvironment) {
    return requestedEnvironment;
  }

  if (process.env.TOOLIST_ENV) {
    return resolveEnvironmentName(process.env.TOOLIST_ENV);
  }

  return config?.activeEnvironment ?? DEFAULT_ENVIRONMENT;
}

function getNextActiveEnvironment(
  profiles: ToollistConfig['profiles'],
  currentEnvironment: ToolistEnvironment,
): ToolistEnvironment {
  if (profiles[currentEnvironment]) {
    return currentEnvironment;
  }

  for (const environment of ['prod', 'test', 'dev'] as const) {
    if (profiles[environment]) {
      return environment;
    }
  }

  return DEFAULT_ENVIRONMENT;
}

export async function logoutCommand(
  args: LogoutCommandArgs,
  dependencies: Partial<LogoutDependencies> = {},
): Promise<LogoutCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const config = await deps.loadConfig(args.configPath);

  if (!config) {
    return {
      loggedOut: true,
    };
  }

  const environment = resolveSelectedEnvironment(args.env, config);
  const shouldClearActiveProfile = !args.env && !process.env.TOOLIST_ENV && !!getActiveProfile(config);

  if (!shouldClearActiveProfile && !getProfileForEnvironment(config, environment)) {
    return {
      loggedOut: true,
    };
  }

  const profiles = { ...config.profiles };
  if (!shouldClearActiveProfile) {
    delete profiles[environment];
  }

  const nextConfig: ToollistConfig = {
    activeEnvironment: getNextActiveEnvironment(profiles, config.activeEnvironment),
    profiles,
  };

  if (!shouldClearActiveProfile && getActiveProfile(config)) {
    nextConfig.activeProfile = config.activeProfile;
  }

  if (Object.keys(profiles).length === 0 && !nextConfig.activeProfile) {
    await deps.clearConfig(args.configPath);
  } else {
    await deps.saveConfig(nextConfig, args.configPath);
  }

  return {
    loggedOut: true,
  };
}
