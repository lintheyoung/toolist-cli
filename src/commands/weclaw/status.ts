import { checkWeClawHealth } from '../../lib/weclaw-local.js';

export interface WeClawStatusCommandArgs {
  weclawUrl: string;
}

export interface WeClawStatusCommandResult {
  ok: true;
  weclawUrl: string;
}

export interface WeClawStatusDependencies {
  checkWeClawHealth: typeof checkWeClawHealth;
}

function createDefaultDependencies(): WeClawStatusDependencies {
  return {
    checkWeClawHealth,
  };
}

export async function weclawStatusCommand(
  args: WeClawStatusCommandArgs,
  dependencies: Partial<WeClawStatusDependencies> = {},
): Promise<WeClawStatusCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  return deps.checkWeClawHealth({
    baseUrl: args.weclawUrl,
  });
}
