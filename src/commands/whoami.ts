import { apiRequest } from '../lib/http.js';
import { loadConfig, type ToollistConfig } from '../lib/config.js';
import {
  resolveEnvironmentBaseUrl,
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

function getRequiredConfig(config: ToollistConfig | null): ToollistConfig {
  if (!config?.accessToken) {
    throw new Error('No saved login found. Run `toollist login` first.');
  }

  return config;
}

export async function whoamiCommand(
  args: WhoamiCommandArgs,
  dependencies: Partial<WhoamiDependencies> = {},
): Promise<WhoamiCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const config = getRequiredConfig(await deps.loadConfig(args.configPath));
  const response = await deps.apiRequest<WhoamiResponse>({
    baseUrl: args.env ? resolveEnvironmentBaseUrl(args.env) : config.baseUrl,
    token: config.accessToken,
    method: 'GET',
    path: '/api/cli/me',
  });

  return response.data;
}
