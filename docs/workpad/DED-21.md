# DED-21 Workpad

## Summary

Classified as complex because this changes CLI behavior across shared job polling, multiple high-level commands, stderr/stdout contracts, and integration tests.

## Intended Change

- Add a shared progress reporter with stderr and silent implementations.
- Inject the stderr reporter from the CLI for the MVP advanced commands:
  - `document docx-to-markdown`
  - `document docx-to-markdown-batch`
  - `image remove-watermark`
  - `image remove-watermark-batch`
- Keep command-level defaults silent so direct command calls and existing tests are not forced to capture progress.
- Add an optional status-change callback to `waitJobCommand`.
- Report upload, job creation, wait status changes, download start, and saved output on stderr.
- Preserve stdout as final JSON only, including `--json`.
- Keep DED-20 job failure messages intact and make sure failed terminal status is visible before the formatted failure details.

## Root Cause Notes

- High-level commands currently call `uploadCommand`, create jobs, optionally call `waitJobCommand`, and optionally download files without any progress hook.
- `waitJobCommand` polls until terminal but has no callback for status changes.
- CLI `io.stderr` is only used for error paths and missing argument messages in these commands.

## Commands Run

- `git status --short --branch`
- `git remote -v`
- Linear issue/state query and move to `In Progress`
- `git checkout -b symphony/DED-21-progress-stderr`
- Repository scan with `rg` and focused `sed` reads
- `npm test -- tests/unit/progress-reporter.test.ts tests/integration/jobs-command.test.ts tests/integration/document-docx-to-markdown-command.test.ts tests/integration/image-remove-watermark-command.test.ts tests/integration/image-remove-watermark-batch-command.test.ts`
- `npm ci`
- Red check rerun of the focused progress suite above
- Focused progress suite after implementation
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run verify:pack-install`
- Hosted credential checks for `TOOLLIST_TEST_TOKEN` and default config
- `npm run smoke:test`
- `git fetch origin --prune`
- `git rebase origin/staging`
- Post-sync `npm run lint`
- Post-sync `npm test`
- Post-sync `npm run build`
- Post-sync `npm run verify:pack-install`

## Validation Results

- Initial focused test command could not run until dependencies were installed: `vitest: command not found`.
- Red check after `npm ci` failed as expected: missing `src/lib/progress-reporter.ts`, missing `onStatus` callback behavior, and missing stderr progress in target commands.
- Focused progress suite after implementation passed: 5 files, 35 tests.
- `npm run lint` passed.
- `npm test` passed: 31 files, 181 tests.
- `npm run build` passed.
- `npm run verify:pack-install` passed and verified `toolist-cli-0.1.0.tgz`.
- Final sync: `git rebase origin/staging` reported the branch is up to date.
- Post-sync `npm run lint` passed.
- Post-sync `npm test` passed: 31 files, 181 tests.
- Post-sync `npm run build` passed.
- Post-sync `npm run verify:pack-install` passed and verified `toolist-cli-0.1.0.tgz`.

## Blockers

- Hosted `--env test` smoke is blocked in this shell because `TOOLLIST_TEST_TOKEN` is unset and the default Toolist config is missing.
- `npm run smoke:test` fails fast with `Missing TOOLLIST_TEST_TOKEN for hosted test smoke.`
