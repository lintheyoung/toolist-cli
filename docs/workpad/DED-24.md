# DED-24 Workpad

## Summary

Add stage-specific network error context and light retry handling for advanced CLI command paths:

- API transport stages: create upload, complete upload, create job.
- Presigned upload PUT: stage context only.
- Job polling: retry transient polling errors with 1s and 3s delays without changing timeout semantics.
- Output download: retry transient fetch failures with 1s and 3s delays.

The implementation should keep stdout as final JSON only and preserve existing job failure/progress stderr behavior.

## Intended Change

- Add shared stage/retry helpers in `src/lib/retry.ts`.
- Extend `apiRequest()` with optional `stage` and `retry` arguments that apply only to fetch transport failures.
- Pass stage/retry options from upload, create-job, polling, and output-download call sites.
- Add targeted unit/integration tests for the acceptance criteria.

## Commands Run

- `git fetch origin staging`
- `npm ci`
- `npm test -- tests/unit/http.test.ts tests/integration/jobs-command.test.ts tests/integration/image-remove-watermark-command.test.ts tests/integration/files-upload-command.test.ts`
- `npm test`
- `npm run lint && npm test && npm run build && npm run verify:pack-install`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js tools list --env test --config-path /Users/dede/.config/toollist/config.json --json >/tmp/ded-24-tools-list-smoke.json && wc -c /tmp/ded-24-tools-list-smoke.json`
- Code Review round 2 requested rework for non-retryable `withRetry` stage context and direct retry helper tests.
- `npm test -- tests/unit/retry.test.ts`
- `npm test -- tests/unit/retry.test.ts tests/integration/jobs-command.test.ts tests/unit/http.test.ts`

## Validation Results

- Focused tests: 35 passed before the timeout regression test was added.
- Full required validation: `npm run lint && npm test && npm run build && npm run verify:pack-install` passed with 196 tests after rework.
- Hosted smoke helper found saved test config at `/Users/dede/.config/toollist/config.json`.
- Generic `npm run smoke:test` is token-only and failed with missing `TOOLLIST_TEST_TOKEN`; direct CLI smoke using saved config passed and wrote 8208 bytes of JSON output.
- Rework red/green: `tests/unit/retry.test.ts` failed before the non-retryable stage-context fix, then passed with 6 tests.
- Rework focused regression: retry helper, jobs polling, and API HTTP tests passed with 27 tests.

## Blockers

- None currently.
