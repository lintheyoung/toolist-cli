import { clearConfig, loadConfig } from '../lib/config.js';
import {
  resolveEnvironmentBaseUrl,
  type ToolistEnvironment,
} from '../lib/environments.js';

export interface LogoutCommandArgs {
  configPath?: string;
  env?: ToolistEnvironment;
}

export interface LogoutDependencies {
  clearConfig: typeof clearConfig;
  loadConfig: typeof loadConfig;
}

export interface LogoutCommandResult {
  loggedOut: true;
}

function createDefaultDependencies(): LogoutDependencies {
  return {
    clearConfig,
    loadConfig,
  };
}

export async function logoutCommand(
  args: LogoutCommandArgs,
  dependencies: Partial<LogoutDependencies> = {},
): Promise<LogoutCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  if (args.env) {
    const config = await deps.loadConfig(args.configPath);

    if (config?.baseUrl && config.baseUrl !== resolveEnvironmentBaseUrl(args.env)) {
      throw new Error(`Saved login does not target the ${args.env} environment.`);
    }
  }

  await deps.clearConfig(args.configPath);

  return {
    loggedOut: true,
  };
}
