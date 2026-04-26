# DED-23 Workpad

## Summary

Classified as complex because this changes `image remove-watermark-batch` behavior across input partitioning, hosted job orchestration, ZIP output handling, progress output, failure formatting, CLI parsing, and tests.

## Intended Change

- Add `--chunk-size <n>` to `toolist image remove-watermark-batch`, defaulting to `5` and rejecting values greater than `5` or less than `1`.
- Resolve all inputs once, split them into chunks, and submit one `image.gemini_nb_remove_watermark_batch` job per chunk.
- Preserve the no-wait path by returning a chunk summary after job creation.
- On wait/output paths, wait for every chunk, download every chunk result ZIP, and merge outputs into one final ZIP.
- Keep stdout as final JSON only and write progress to stderr.
- Reuse DED-20 job failure formatting while adding chunk index and input count context.
- Keep other image batch commands unchanged.

## Commands Run

- `git status --short --branch`
- Linear issue/state query and move to `In Progress`
- `git fetch origin staging && git checkout -b symphony/DED-23-remove-watermark-chunks origin/staging`
- Repository scan with `rg`, `sed`, and `git log`
- `npm test -- tests/unit/zip-merge.test.ts tests/unit/progress-reporter.test.ts tests/integration/image-remove-watermark-batch-command.test.ts` (initial dependency-missing check)
- `npm ci`
- Red check: `npm test -- tests/unit/zip-merge.test.ts tests/unit/progress-reporter.test.ts tests/integration/image-remove-watermark-batch-command.test.ts`
- Focused green check: `npm test -- tests/unit/zip-merge.test.ts tests/unit/progress-reporter.test.ts tests/integration/image-remove-watermark-batch-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run verify:pack-install`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- Hosted smoke attempt 1 with 30 generated 1x1 PNG inputs and `--env test --config-path /Users/dede/.config/toollist/config.json`
- Hosted smoke attempt 2 with 30 generated 640x480 PNG inputs and `--env test --config-path /Users/dede/.config/toollist/config.json`
- Count fallback fix check: `npm test -- tests/unit/zip-merge.test.ts tests/integration/image-remove-watermark-batch-command.test.ts && npm run lint`
- `git fetch origin staging && git rebase origin/staging`
- Post-sync `npm run lint`
- Post-sync `npm test`
- Post-sync `npm run build`
- Post-sync `npm run verify:pack-install`

## Validation Results

- Initial focused test command could not start until dependencies were installed: `vitest: command not found`.
- Red check failed as expected because `zip-merge` did not exist, `--chunk-size` was unknown, chunk progress methods were missing, and the command still ran as one job.
- Focused green check passed: 3 files, 10 tests.
- `npm run lint` passed.
- `npm test` passed: 33 files, 217 tests.
- `npm run build` passed.
- `npm run verify:pack-install` passed and verified `toolist-cli-0.1.0.tgz`.
- Hosted auth helper returned `status: ok`, `auth_mode: config`, and config path `/Users/dede/.config/toollist/config.json`.
- Hosted smoke attempt 1 created chunk 1 job `job_a6a8ce2e3fac49e6947fb256870c7616` and failed in the provider with `PROVIDER_REQUEST_FAILED`; external task id `2x92ydx9gsrmw0cxppebnm7kbc`.
- Hosted smoke attempt 2 created chunk 1 job `job_45d257ee018543c89241a9a97bb793e5` and failed in the provider with `PROVIDER_REQUEST_FAILED`; error message `Replicate request failed with status 503`; external task id `replicate_job_45d257ee018543c89241a9a97bb793e5`.
- Count fallback fix check passed: 2 files, 8 tests; `npm run lint` passed.
- Final sync: branch was already up to date with `origin/staging`.
- Post-sync `npm run lint` passed.
- Post-sync `npm test` passed: 33 files, 217 tests.
- Post-sync `npm run build` passed.
- Post-sync `npm run verify:pack-install` passed and verified `toolist-cli-0.1.0.tgz`.

## Blockers

- Hosted smoke cannot complete because the test provider failed on chunk 1 after the gateway created a job. Auth and the gateway contract were present; the blocker is downstream provider availability/input acceptance in test.
