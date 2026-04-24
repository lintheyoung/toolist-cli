import { apiRequest } from '../lib/http.js';
import {
  getProfileForEnvironment,
  loadConfig,
  type ToollistConfig,
  type ToollistProfile,
} from '../lib/config.js';
import {
  resolveEnvironmentSelection,
  resolveSelectedProfileBaseUrl,
  type ToolistEnvironment,
} from '../lib/environments.js';
import { extendedNetworkRetryOptions, type RetryHandler } from '../lib/retry.js';

export interface WhoamiCommandArgs {
  configPath?: string;
  env?: ToolistEnvironment;
  onRetry?: RetryHandler;
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
  const selection = resolveEnvironmentSelection({
    requestedEnvironment: args.env,
    configuredEnvironment: config?.activeEnvironment,
    environmentVariable: process.env.TOOLIST_ENV,
  });
  const environment = selection.environment;
  const selectedProfile = getProfileForEnvironment(config, environment);
  const profile = getRequiredProfile(selectedProfile);
  const response = await deps.apiRequest<WhoamiResponse>({
    baseUrl: resolveSelectedProfileBaseUrl({
      environment,
      profileBaseUrl: profile.baseUrl,
      isExplicitHostedSelection: selection.isExplicitHostedSelection,
    }),
    token: profile.accessToken,
    method: 'GET',
    path: '/api/cli/me',
    stage: 'Whoami request failed',
    retry: extendedNetworkRetryOptions(args.onRetry),
  });

  return response.data;
}
