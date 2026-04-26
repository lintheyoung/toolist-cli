import { describe, expect, it } from 'vitest';

import {
  assertJobSucceeded,
  formatJobFailure,
  isFailedJobStatus,
  JobFailureError,
} from '../../src/lib/job-errors.js';

describe('job error helpers', () => {
  it('identifies failed terminal job statuses', () => {
    expect(isFailedJobStatus('failed')).toBe(true);
    expect(isFailedJobStatus('canceled')).toBe(true);
    expect(isFailedJobStatus('timed_out')).toBe(true);
    expect(isFailedJobStatus('succeeded')).toBe(false);
    expect(isFailedJobStatus('queued')).toBe(false);
  });

  it('formats known job failure fields without undefined placeholders', () => {
    const message = formatJobFailure({
      id: 'job_failed_123',
      status: 'failed',
      errorCode: 'PROVIDER_REQUEST_FAILED',
      errorMessage: 'Replicate request failed with status 402',
      progress: {
        externalTaskId: 'replicate_prediction_123',
        providerStatus: 'failed',
        submittedAt: '2026-04-21T02:00:00.000Z',
        completedAt: '2026-04-21T02:00:03.000Z',
        providerDurationMs: 3000,
      },
    });

    expect(message).toContain('Job failed: job_failed_123');
    expect(message).toContain('Status: failed');
    expect(message).toContain('Error code: PROVIDER_REQUEST_FAILED');
    expect(message).toContain('Error message: Replicate request failed with status 402');
    expect(message).toContain('External task id: replicate_prediction_123');
    expect(message).toContain('Provider status: failed');
    expect(message).toContain('Submitted at: 2026-04-21T02:00:00.000Z');
    expect(message).toContain('Completed at: 2026-04-21T02:00:03.000Z');
    expect(message).toContain('Provider duration ms: 3000');
    expect(message).not.toContain('undefined');
  });

  it('throws a job failure error for canceled jobs', () => {
    expect(() =>
      assertJobSucceeded({
        id: 'job_canceled_123',
        status: 'canceled',
        errorMessage: 'User canceled the job.',
      }),
    ).toThrow(JobFailureError);
    expect(() =>
      assertJobSucceeded({
        id: 'job_canceled_123',
        status: 'canceled',
        errorMessage: 'User canceled the job.',
      }),
    ).toThrow('Status: canceled');
  });

  it('does not throw for succeeded jobs missing output', () => {
    expect(() =>
      assertJobSucceeded({
        id: 'job_succeeded_without_output',
        status: 'succeeded',
      }),
    ).not.toThrow();
  });
});
