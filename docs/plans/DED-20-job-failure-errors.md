# DED-20 Job Failure Error Plan

## Goal

Make every advanced CLI command that waits for a job surface backend job failure details before following the success output-file path.

## Approach

1. Add regression tests first for representative CLI commands and the manifest batch item runner.
2. Add `src/lib/job-errors.ts` with `isFailedJobStatus`, `formatJobFailure`, `JobFailureError`, and `assertJobSucceeded`.
3. Import `assertJobSucceeded` in all commands that call `waitJobCommand` and need succeeded-job output handling.
4. Update `runBatchItem` to record formatted job failure details as item errors instead of dropping them.
5. Run focused tests, then `npm run lint`, `npm test`, `npm run build`, and `npm run verify:pack-install`.

## Test Targets

- `tests/integration/image-remove-watermark-command.test.ts`
- `tests/integration/document-docx-to-markdown-command.test.ts`
- `tests/integration/batch-run-command.test.ts`
- `tests/unit/job-errors.test.ts`

## Handoff

Target branch: `symphony/DED-20-job-failure-errors`

Target PR base: `staging`
