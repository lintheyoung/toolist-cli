import { apiRequest } from '../../lib/http.js';

export interface GetJobCommandArgs {
  jobId: string;
  baseUrl: string;
  token: string;
  configPath?: string;
}

export interface JobDetails {
  id: string;
  status: string;
  toolName: string;
  toolVersion: string;
  [key: string]: unknown;
}

export interface GetJobCommandResult extends JobDetails {}

export interface GetJobDependencies {
  apiRequest: typeof apiRequest;
}

type GetJobResponse = {
  data: {
    job: GetJobCommandResult;
  };
  request_id: string;
};

function createDefaultDependencies(): GetJobDependencies {
  return {
    apiRequest,
  };
}

export async function getJobCommand(
  args: GetJobCommandArgs,
  dependencies: Partial<GetJobDependencies> = {},
): Promise<GetJobCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };

  const response = await deps.apiRequest<GetJobResponse>({
    baseUrl: args.baseUrl,
    token: args.token,
    method: 'GET',
    path: `/api/v1/jobs/${encodeURIComponent(args.jobId)}`,
  });

  return response.data.job;
}
