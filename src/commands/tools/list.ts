import { apiRequest } from '../../lib/http.js';
import { extendedNetworkRetryOptions, type RetryHandler } from '../../lib/retry.js';

export interface ListToolsCommandArgs {
  baseUrl: string;
  token: string;
  configPath?: string;
  onRetry?: RetryHandler;
}

export interface ToolDefinition {
  name: string;
  version: string;
  accepted_mime_types: string[];
  max_file_size_bytes: number;
}

export interface ListToolsCommandResult {
  tools: ToolDefinition[];
}

export interface ListToolsDependencies {
  apiRequest: typeof apiRequest;
}

type ListToolsResponse = {
  data: ListToolsCommandResult;
  request_id: string;
};

function createDefaultDependencies(): ListToolsDependencies {
  return {
    apiRequest,
  };
}

export async function listToolsCommand(
  args: ListToolsCommandArgs,
  dependencies: Partial<ListToolsDependencies> = {},
): Promise<ListToolsCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const response = await deps.apiRequest<ListToolsResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'GET',
    path: '/api/v1/tools',
    stage: 'List tools request failed',
    retry: extendedNetworkRetryOptions(args.onRetry),
  });

  return response.data;
}
