export type ToolistEnvironment = 'prod' | 'test' | 'dev';

export const DEFAULT_ENVIRONMENT: ToolistEnvironment = 'prod';

const ENVIRONMENT_BASE_URLS: Record<ToolistEnvironment, string> = {
  prod: 'https://tooli.st',
  test: 'https://test.tooli.st',
  dev: 'http://localhost:3024',
};

export function resolveEnvironmentName(
  value: string | undefined,
): ToolistEnvironment {
  if (!value) {
    return DEFAULT_ENVIRONMENT;
  }

  if (value === 'prod' || value === 'test' || value === 'dev') {
    return value;
  }

  throw new Error(`Unknown environment: ${value}`);
}

export function resolveEnvironmentBaseUrl(
  env: ToolistEnvironment,
): string {
  return ENVIRONMENT_BASE_URLS[env];
}

export function inferEnvironmentFromBaseUrl(
  baseUrl: string,
): ToolistEnvironment | null {
  let normalizedBaseUrl: string;

  try {
    normalizedBaseUrl = new URL(baseUrl).origin;
  } catch {
    return null;
  }

  for (const environment of ['prod', 'test', 'dev'] as const) {
    if (normalizedBaseUrl === new URL(resolveEnvironmentBaseUrl(environment)).origin) {
      return environment;
    }
  }

  return null;
}
