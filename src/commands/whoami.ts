import { apiRequest } from '../lib/http.js';
import {
  getProfileForEnvironment,
  loadConfig,
  type ToollistConfig,
  type ToollistProfile,
} from '../lib/config.js';
import {
  DEFAULT_ENVIRONMENT,
  resolveEnvironmentBaseUrl,
  resolveEnvironmentName,
  type ToolistEnvironment,
} from '../lib/environments.js';

export interface WhoamiCommandArgs {
  configPath?: string;
  env?: ToolistEnvironment;
}

export interface WhoamiCommandResult {
  user: {
    id: number;
    email: string;
  };
  workspace: {
    id: number;
    name: string;
  };
  scopes: string[];
  active_job_count: number;
  max_concurrent_jobs: number;
}

export interface WhoamiDependencies {
  loadConfig: typeof loadConfig;
  apiRequest: typeof apiRequest;
}

type WhoamiResponse = {
  data: WhoamiCommandResult;
  request_id: string;
};

function createDefaultDependencies(): WhoamiDependencies {
  return {
    loadConfig,
    apiRequest,
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

function getRequiredProfile(
  profile: ToollistProfile | null,
): ToollistProfile {
  if (!profile?.accessToken) {
    throw new Error('No saved login found. Run `toollist login` first.');
  }

  return profile;
}

export async function whoamiCommand(
  args: WhoamiCommandArgs,
  dependencies: Partial<WhoamiDependencies> = {},
): Promise<WhoamiCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const config = await deps.loadConfig(args.configPath);
  const environment = resolveSelectedEnvironment(args.env, config);
  const profile = getRequiredProfile(getProfileForEnvironment(config, environment));
  const response = await deps.apiRequest<WhoamiResponse>({
    baseUrl: profile.baseUrl ?? resolveEnvironmentBaseUrl(environment),
    token: profile.accessToken,
    method: 'GET',
    path: '/api/cli/me',
  });

  return response.data;
}
