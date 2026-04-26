import { describe, expect, it } from 'vitest';

import {
  createStderrProgressReporter,
  silentProgressReporter,
} from '../../src/lib/progress-reporter.js';

describe('progress reporter', () => {
  it('writes stage progress lines to stderr', () => {
    let stderr = '';
    const reporter = createStderrProgressReporter((chunk) => {
      stderr += chunk;
    });

    reporter.uploadingInput();
    reporter.uploadedFile('file_source_123');
    reporter.creatingJob();
    reporter.createdJob('job_123');
    reporter.waitingForJob();
    reporter.jobStatus('queued');
    reporter.jobStatus('queued');
    reporter.jobStatus('running');
    reporter.downloadingOutput('file_output_123');
    reporter.preparingChunk(1, 6, 5);
    reporter.savedChunkOutput('/tmp/chunk-001.zip');
    reporter.mergingChunkOutputs();
    reporter.savedOutput('/tmp/output.zip');

    expect(stderr).toBe(
      [
        'Uploading input...',
        'Uploaded file: file_source_123',
        'Creating job...',
        'Created job: job_123',
        'Waiting for job...',
        'Status: queued',
        'Status: running',
        'Downloading output: file_output_123',
        'Preparing chunk 1/6 (5 files)...',
        'Saved chunk output: /tmp/chunk-001.zip',
        'Merging chunk outputs...',
        'Saved output: /tmp/output.zip',
      ].join('\n') + '\n',
    );
  });

  it('can be used silently by direct command calls', () => {
    expect(() => {
      silentProgressReporter.uploadingInput();
      silentProgressReporter.uploadedFile('file_source_123');
      silentProgressReporter.creatingJob();
      silentProgressReporter.createdJob('job_123');
      silentProgressReporter.waitingForJob();
      silentProgressReporter.jobStatus('queued');
      silentProgressReporter.downloadingOutput('file_output_123');
      silentProgressReporter.preparingChunk(1, 6, 5);
      silentProgressReporter.savedChunkOutput('/tmp/chunk-001.zip');
      silentProgressReporter.mergingChunkOutputs();
      silentProgressReporter.savedOutput('/tmp/output.zip');
    }).not.toThrow();
  });
});
