const FAILED_JOB_STATUSES = new Set(['failed', 'canceled', 'timed_out']);

type UnknownRecord = Record<string, unknown>;

export class JobFailureError extends Error {
  job: unknown;

  constructor(job: unknown) {
    super(formatJobFailure(job));
    this.name = 'JobFailureError';
    this.job = job;
  }
}

export function isFailedJobStatus(status: string): boolean {
  return FAILED_JOB_STATUSES.has(status);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getRecord(value: unknown, key: string): UnknownRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const field = value[key];

  return isRecord(field) ? field : undefined;
}

function getField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringifyField(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const stringValue = stringifyField(value);

    if (stringValue) {
      return stringValue;
    }
  }

  return undefined;
}

function addLine(lines: string[], label: string, value: unknown): void {
  const stringValue = stringifyField(value);

  if (stringValue) {
    lines.push(`${label}: ${stringValue}`);
  }
}

export function formatJobFailure(job: unknown): string {
  const error = getRecord(job, 'error');
  const result = getRecord(job, 'result');
  const resultError = getRecord(result, 'error');
  const progress = getRecord(job, 'progress');
  const progressError = getRecord(progress, 'error');

  const jobId = firstString(getField(job, 'id'), getField(job, 'jobId'), getField(job, 'job_id'));
  const status = firstString(getField(job, 'status'));
  const topLevelError = getField(job, 'error');
  const progressExternalTaskId = firstString(
    getField(progress, 'externalTaskId'),
    getField(progress, 'external_task_id'),
    getField(progress, 'providerExternalTaskId'),
    getField(progress, 'provider_external_task_id'),
  );

  const errorCode = firstString(
    getField(job, 'errorCode'),
    getField(job, 'error_code'),
    getField(error, 'code'),
    getField(result, 'errorCode'),
    getField(result, 'error_code'),
    getField(resultError, 'code'),
    getField(progress, 'errorCode'),
    getField(progress, 'error_code'),
    getField(progressError, 'code'),
  );
  const errorMessage = firstString(
    getField(job, 'errorMessage'),
    getField(job, 'error_message'),
    topLevelError,
    getField(error, 'message'),
    getField(result, 'errorMessage'),
    getField(result, 'error_message'),
    getField(resultError, 'message'),
    getField(progress, 'errorMessage'),
    getField(progress, 'error_message'),
    getField(progressError, 'message'),
  );
  const externalTaskId = firstString(
    progressExternalTaskId,
    getField(job, 'externalTaskId'),
    getField(job, 'external_task_id'),
    getField(job, 'providerExternalTaskId'),
    getField(job, 'provider_external_task_id'),
  );
  const providerStatus = firstString(
    getField(progress, 'providerStatus'),
    getField(progress, 'provider_status'),
    getField(job, 'providerStatus'),
    getField(job, 'provider_status'),
  );

  const lines = [`Job failed: ${jobId ?? 'unknown'}`];
  addLine(lines, 'Status', status);
  addLine(lines, 'Error code', errorCode);
  addLine(lines, 'Error message', errorMessage);
  addLine(lines, 'External task id', externalTaskId);
  addLine(lines, 'Provider status', providerStatus);
  addLine(lines, 'Submitted at', firstString(getField(progress, 'submittedAt'), getField(progress, 'submitted_at')));
  addLine(lines, 'Completed at', firstString(getField(progress, 'completedAt'), getField(progress, 'completed_at')));
  addLine(
    lines,
    'Provider duration ms',
    firstString(getField(progress, 'providerDurationMs'), getField(progress, 'provider_duration_ms')),
  );

  return lines.join('\n');
}

export function assertJobSucceeded(job: unknown): void {
  const status = firstString(getField(job, 'status'));

  if (status && isFailedJobStatus(status)) {
    throw new JobFailureError(job);
  }
}
