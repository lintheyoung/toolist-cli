import { clearConfig } from '../lib/config.js';

export interface LogoutCommandArgs {
  configPath?: string;
}

export interface LogoutDependencies {
  clearConfig: typeof clearConfig;
}

export interface LogoutCommandResult {
  loggedOut: true;
}

function createDefaultDependencies(): LogoutDependencies {
  return {
    clearConfig,
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

  await deps.clearConfig(args.configPath);

  return {
    loggedOut: true,
  };
}
