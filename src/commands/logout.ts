import {
  clearConfig,
  getProfileForEnvironment,
  loadConfig,
  saveConfig,
  type ToollistConfig,
} from '../lib/config.js';
import {
  DEFAULT_ENVIRONMENT,
  resolveEnvironmentSelection,
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

  const environment = resolveEnvironmentSelection({
    requestedEnvironment: args.env,
    configuredEnvironment: config?.activeEnvironment,
    environmentVariable: process.env.TOOLIST_ENV,
  }).environment;
  if (!getProfileForEnvironment(config, environment)) {
    return {
      loggedOut: true,
    };
  }

  const profiles = { ...config.profiles };
  delete profiles[environment];

  const nextConfig: ToollistConfig = {
    activeEnvironment: getNextActiveEnvironment(profiles, config.activeEnvironment),
    profiles,
  };

  if (Object.keys(profiles).length === 0) {
    await deps.clearConfig(args.configPath);
  } else {
    await deps.saveConfig(nextConfig, args.configPath);
  }

  return {
    loggedOut: true,
  };
}
