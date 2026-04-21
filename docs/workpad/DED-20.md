# DED-20 Workpad

## Summary

Classified as complex because this changes CLI behavior across multiple high-level commands, shared job error formatting, manifest batch item handling, and integration tests.

## Intended Change

- Add a shared job failure helper that detects `failed`, `canceled`, and `timed_out` jobs.
- Format backend job failure details from top-level and `progress` fields into a multi-line error message.
- Call the helper immediately after waiting or receiving a terminal job in high-level commands before output-file handling.
- Preserve `The ... job did not produce an output file.` for succeeded jobs that genuinely lack output.
- Preserve batch command summary behavior while recording real job failure details in failed item state.

## Root Cause Notes

- `src/commands/jobs/wait.ts` returns terminal statuses including failures.
- High-level commands currently use failed jobs as if they succeeded, then throw missing-output errors.
- `src/lib/batch-item-runner.ts` maps failed job status to failed state but does not copy backend error details.

## Commands Run

- `git fetch origin --prune`
- `git switch -c symphony/DED-20-job-failure-errors origin/staging`
- Repository scan with `rg` and focused `sed` reads.
- `npm ci`
- `npm test -- tests/integration/image-remove-watermark-command.test.ts tests/integration/document-docx-to-markdown-command.test.ts tests/integration/image-remove-background-command.test.ts tests/integration/batch-run-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run verify:pack-install`
- `npm test -- tests/unit/job-errors.test.ts`
- `git fetch origin --prune`
- `git rebase origin/staging`
- Post-sync `npm run lint`
- Post-sync `npm test`
- Post-sync `npm run build`
- Post-sync `npm run verify:pack-install`

## Validation Results

- Red test pass confirmed for the regression suite above: 4 expected failures.
- Current failures show missing-output messages for high-level commands and missing batch item error details.
- Focused regression suite after implementation passes: 4 files, 31 tests.
- `npm test -- tests/unit/job-errors.test.ts` passed: 1 file, 4 tests.
- Fresh `npm run lint` passed.
- Fresh `npm test` passed: 30 files, 178 tests.
- Fresh `npm run build` passed.
- Fresh `npm run verify:pack-install` passed and verified `toolist-cli-0.1.0.tgz`.
- Final sync: `git rebase origin/staging` reported the branch is up to date.
- Post-sync `npm run lint` passed.
- Post-sync `npm test` passed: 30 files, 178 tests.
- Post-sync `npm run build` passed.
- Post-sync `npm run verify:pack-install` passed and verified `toolist-cli-0.1.0.tgz`.

## Blockers

- None.
