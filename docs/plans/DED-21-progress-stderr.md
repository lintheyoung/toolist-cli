# DED-21 Progress Stderr Plan

## Goal

Add stage progress output on stderr for the MVP long-running high-level commands while keeping stdout as final JSON only.

## Approach

1. Add tests first for:
   - shared progress reporter output and silent behavior
   - `waitJobCommand` status-change callback dedupe
   - document DOCX single/batch progress in CLI integration tests
   - image remove-watermark single/batch progress in CLI integration tests
2. Add `src/lib/progress-reporter.ts` with a `ProgressReporter`, stderr implementation, and silent implementation.
3. Extend `waitJobCommand` args with `onStatus?: (status, job) => void` and invoke it only when a polled status changes.
4. Add optional `progress` dependencies to the four MVP command modules, defaulting to `silentProgressReporter`.
5. Emit upload/create/wait/download progress in those command modules.
6. Inject `createStderrProgressReporter(io.stderr)` from `src/cli.ts` for those four commands only.
7. Run focused tests, then full validation: `npm run lint`, `npm test`, `npm run build`, `npm run verify:pack-install`.
8. Sync with `origin/staging`, rerun validation, push the branch, create/update PR, and hand off in Linear.

## Test Targets

- `tests/unit/progress-reporter.test.ts`
- `tests/integration/jobs-command.test.ts`
- `tests/integration/document-docx-to-markdown-command.test.ts`
- `tests/integration/image-remove-watermark-command.test.ts`
- `tests/integration/image-remove-watermark-batch-command.test.ts`

## Handoff

Target branch: `symphony/DED-21-progress-stderr`

Target PR base: `staging`
