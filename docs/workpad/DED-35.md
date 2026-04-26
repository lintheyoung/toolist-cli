## Summary

Classified as complex because this changes `image remove-watermark-batch --wait --output` behavior around asynchronous hosted job artifacts, adds polling/retry behavior, and requires hosted smoke validation.

Root cause:
- `waitForChunkJob()` returns as soon as the job is terminal and successful.
- The output download path immediately calls `getOutputFileId(job)`.
- If the terminal job payload does not yet include `result.output.outputFileId`, the command fails before refreshing the job detail.

Intended change:
- Add a reusable output artifact visibility helper.
- For `remove-watermark-batch --wait --output`, wait briefly for `outputFileId` after success before downloading each chunk output.
- Preserve no-output and no-wait behavior.
- Include chunk index, job id, status, and final job detail snippet in missing-output diagnostics.

## Commands Run

- `git fetch origin && git switch -c symphony/DED-35-wait-output-file-id`
- `rg -n "waitForChunkJob|getOutputFileId|remove-watermark-batch|outputFileId|jobs get|api/v1/jobs" src test tests . --glob '!node_modules' --glob '!dist'`
- `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts` (initial dependency check failed: `vitest` missing)
- `npm ci`
- `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts` (RED: 3 expected failures for immediate missing-output behavior)
- `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts` (GREEN: 17 passed)
- `npm run lint`
- `npm test`
- `npm run build`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js image remove-watermark-batch --inputs .tmp/ded-35-smoke/image-1.png .tmp/ded-35-smoke/image-2.png --force --wait --timeout 180 --output .tmp/ded-35-smoke/results.zip --env test --config-path /Users/dede/.config/toollist/config.json --json` (provider failed on 1x1 synthetic PNGs; job `job_0566fdcb638541b79e67429c84289082`)
- `node dist/cli.js image remove-watermark-batch --inputs .tmp/ded-35-smoke/image-1.png .tmp/ded-35-smoke/image-2.png --force --wait --timeout 240 --output .tmp/ded-35-smoke/results.zip --env test --config-path /Users/dede/.config/toollist/config.json --json` (larger PNG inputs)
- `git fetch origin staging && git rebase origin/staging` (already up to date)
- Post-sync `npm run lint`
- Post-sync `npm test`
- Post-sync `npm run build`
- Post-sync hosted smoke with the same larger-PNG `node dist/cli.js image remove-watermark-batch ... --wait --output ... --env test --config-path /Users/dede/.config/toollist/config.json --json` command
- Opencode review round 1: `changes_requested`
- Rework `npm test -- tests/unit/job-output.test.ts` (RED: 2 expected timeout-budget failures)
- Rework `npm test -- tests/unit/job-output.test.ts` (GREEN: 3 passed)
- Rework `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts` (GREEN: 17 passed)
- Rework `npm run lint`
- Rework `npm test`
- Rework `npm run build`
- Rework hosted smoke with the same larger-PNG `node dist/cli.js image remove-watermark-batch ... --wait --output ... --env test --config-path /Users/dede/.config/toollist/config.json --json` command
- Rework `git fetch origin staging && git rebase origin/staging` (already up to date)
- Rework post-sync `npm run lint`
- Rework post-sync `npm test`
- Rework post-sync `npm run build`
- Second opencode review round 1: `changes_requested`
- Second rework `npm test -- tests/unit/job-output.test.ts` (GREEN: 3 passed)
- Second rework `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts` (GREEN: 17 passed)
- Second rework `npm run lint`
- Second rework `npm test`
- Second rework `npm run build`
- Second rework hosted smoke with the same larger-PNG `node dist/cli.js image remove-watermark-batch ... --wait --output ... --env test --config-path /Users/dede/.config/toollist/config.json --json` command

## Validation Results

- Focused integration tests pass: 17 tests passed.
- `npm run lint`: passed.
- `npm test`: 34 files passed, 242 tests passed.
- `npm run build`: passed.
- Hosted smoke auth: saved CLI config at `/Users/dede/.config/toollist/config.json`.
- Hosted `--wait --output` smoke passed with job `job_07d0a80aec2042799a258010b42e6762`; downloaded `file_job_07d0a80aec2042799a258010b42e6762_output` and wrote `.tmp/ded-35-smoke/results.zip`.
- Branch was up to date with `origin/staging`; post-sync validation passed:
  - `npm run lint`: passed.
  - `npm test`: 34 files passed, 242 tests passed.
  - `npm run build`: passed.
  - Hosted `--wait --output` smoke passed with job `job_e57fdb8dd6334195afe8fc840deea208`; downloaded `file_job_e57fdb8dd6334195afe8fc840deea208_output` and wrote `.tmp/ded-35-smoke/results.zip`.
- Rework addressed opencode round 1 feedback:
  - Added focused `job-output` unit tests for timeout budget behavior.
  - Changed output-ID polling to use a deadline based on `now()`.
  - Capped transient retry sleeps to remaining output-ID wait budget.
- Rework validation passed:
  - `npm test -- tests/unit/job-output.test.ts`: 3 passed.
  - `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts`: 17 passed.
  - `npm run lint`: passed.
  - `npm test`: 35 files passed, 245 tests passed.
  - `npm run build`: passed.
  - Hosted `--wait --output` smoke passed with job `job_a99f131c6d144615976b2fedd950df1b`; downloaded `file_job_a99f131c6d144615976b2fedd950df1b_output` and wrote `.tmp/ded-35-smoke/results.zip`.
- Rework branch remained up to date with `origin/staging`; post-sync validation passed:
  - `npm run lint`: passed.
  - `npm test`: 35 files passed, 245 tests passed.
  - `npm run build`: passed.
- Second rework addressed opencode round 1 feedback by removing the ambiguous early return from the bounded retry sleep callback.
- Second rework validation passed:
  - `npm test -- tests/unit/job-output.test.ts`: 3 passed.
  - `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts`: 17 passed.
  - `npm run lint`: passed.
  - `npm test`: 35 files passed, 245 tests passed.
  - `npm run build`: passed.
  - Hosted `--wait --output` smoke passed with job `job_54ad1079cc0c4569be8ed643e8d6270b`; downloaded `file_job_54ad1079cc0c4569be8ed643e8d6270b_output` and wrote `.tmp/ded-35-smoke/results.zip`.

## Blockers

- None.
