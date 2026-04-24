# DED-31 Workpad

## Summary

Unify transient fetch retry observability for CLI-hosted Toolist API calls and upload/download flows.

Root cause from scan:
- `withRetry()` preserves final stage context, but has no retry event callback, so successful retries are invisible.
- `apiRequest()` only retries when callers pass both `stage` and `retry`; commands like `whoami`, `tools list`, and default `jobs get` currently call it without either.
- Upload create/PUT/complete already have stage context and retry, but use a 3-attempt `1s/3s` window and do not report retry progress.
- Job create calls already have stage context and retry; because create job is a POST without a visible idempotency key in this CLI layer, the retry window should not be broadened as part of this ticket.

Intended change:
- Extend retry options with an optional `onRetry` callback and CLI stderr reporter.
- Add explicit retryable transport classification for `fetch failed`, connection resets/timeouts, DNS transient failures, and Undici `UND_ERR_*` errors.
- Add safe GET retry/stage context for `whoami`, `tools list`, and direct `jobs get`.
- Use a stronger 4-attempt `1s/3s/7s` retry window for upload, output download, job polling, and safe GET API requests.
- Preserve JSON stdout by routing retry/progress lines to stderr only.

## Commands Run

- `git status --short --branch`
- `git log --oneline --decorate -8`
- `rg --files ...`
- `rg -n "withRetry|apiRequest|NETWORK_RETRY|retry|whoami|tools list|jobs get|upload" ...`
- `git fetch origin staging` failed once with `LibreSSL SSL_connect: SSL_ERROR_SYSCALL`.
- `git switch -c symphony/DED-31-retry-observability`
- `npm install`
- `npm test -- tests/unit/retry.test.ts tests/unit/http.test.ts tests/integration/files-upload-command.test.ts tests/integration/whoami-command.test.ts tests/integration/jobs-command.test.ts` failed before implementation for the expected missing retry callback/stage behavior, then passed after implementation.
- `npm run lint`
- `npm test`
- `npm run build`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js whoami --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times.
- `node dist/cli.js tools list --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times.
- `node dist/cli.js files upload --input <png> --public --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times.
- `node dist/cli.js markdown upload-images --input <md> --output <md> --report <json> --public --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times.
- Rework review round 1 found that retryable 5xx API responses lost structured error messages after retry exhaustion.
- `npm test -- tests/unit/http.test.ts` failed before the rework fix with `List tools request failed: HTTP 503 Service Unavailable` instead of the structured API message.
- `npm test -- tests/unit/http.test.ts`
- `npm test -- tests/unit/retry.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- Human review requested two remaining retry gaps: `jobs wait` should retry staged polling `CliError` values with `status >= 500`, and output downloads should retry HTTP 5xx responses while keeping 4xx fail-fast.
- `npm test -- tests/integration/jobs-command.test.ts -t "retries a transient polling 5xx API error"` failed before the rework fix with `Job polling failed: Gateway unavailable.` after one attempt.
- `npm test -- tests/integration/image-remove-watermark-command.test.ts -t "retries a transient output download 5xx response"` failed before the rework fix because the command exited after the first 503 download response.
- `npm test -- tests/integration/jobs-command.test.ts -t "retries a transient polling 5xx API error" && npm test -- tests/integration/image-remove-watermark-command.test.ts -t "retries a transient output download 5xx response"`
- `npm test -- tests/integration/jobs-command.test.ts tests/integration/image-remove-watermark-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js whoami --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times after output-download/polling rework.
- `node dist/cli.js tools list --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times after output-download/polling rework.
- `node dist/cli.js files upload --input <png> --public --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times after output-download/polling rework.
- `node dist/cli.js markdown upload-images --input <md> --output <md> --report <json> --public --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times after output-download/polling rework.
- `git fetch origin staging`
- Opencode review round 2 requested preserving `CliError` structured fields after retryable 5xx retry exhaustion.
- `npm test -- tests/unit/http.test.ts` failed before the structured-error fix because the final staged 503 was a plain `Error`.
- `npm test -- tests/unit/http.test.ts tests/unit/retry.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- Opencode review round 1 requested using retry option objects consistently and hardening retry-marker creation when retry options are passed without a staged retry loop.
- `npm test -- tests/unit/http.test.ts` failed before the hardening fix with a generic unexpected error for an unstaged retryable 503.
- `npm test -- tests/unit/http.test.ts tests/unit/retry.test.ts tests/integration/files-upload-command.test.ts tests/integration/jobs-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- Opencode review round 1 requested making retryable 5xx message extraction clearer about intentional response-body consumption.
- `npm test -- tests/unit/http.test.ts tests/unit/retry.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- `git fetch origin staging`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js whoami --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times after rework.
- `node dist/cli.js tools list --env test --config-path /Users/dede/.config/toollist/config.json --json` looped 5 times after rework.
- Opencode review round 1 requested simplifying `src/lib/http.ts` retryable 5xx body handling to avoid `response.clone()` ambiguity.
- `npm test -- tests/unit/http.test.ts tests/unit/retry.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`

## Validation Results

- `npm run lint`: passed.
- `npm test`: 34 files, 226 tests passed.
- `npm run build`: passed.
- Hosted smoke helper: `status: ok`, `auth_mode: config`, test config path `/Users/dede/.config/toollist/config.json`.
- Hosted smoke: whoami/tools list/files upload/markdown upload-images each passed 5 consecutive `--env test` runs.
- Hosted smoke observability evidence: transient `Whoami request failed: fetch failed` and `Create upload request failed: fetch failed` both emitted retry lines to stderr and recovered.
- Rework regression: structured retryable 5xx API messages are preserved after retry exhaustion; `tests/unit/http.test.ts` now covers the exhausted 503 case.
- Rework validation: `npm run lint`, `npm test` (34 files, 228 tests), `npm run build`, and `git diff --check` passed.
- Rework hosted smoke: whoami and tools list each passed 5 consecutive `--env test` runs using saved CLI config.
- Second rework: retryable 5xx message extraction now consumes the discarded retry response directly and no longer stores the discarded `Response` on the marker error.
- Second rework validation: `npm test -- tests/unit/http.test.ts tests/unit/retry.test.ts`, `npm run lint`, `npm test` (34 files, 228 tests), `npm run build`, and `git diff --check` passed.
- Third rework: retryable 5xx message extraction now snapshots status/text and parses the transient body locally with a comment explaining that the retry response is discarded after classification.
- Third rework validation: `npm test -- tests/unit/http.test.ts tests/unit/retry.test.ts`, `npm run lint`, `npm test` (34 files, 228 tests), `npm run build`, and `git diff --check` passed.
- Fourth rework: retry-marker 5xx errors are now created only when a staged retry loop is active, unstaged retry options still parse structured 5xx API errors normally, and upload/job polling forward `retry.onRetry` consistently.
- Fourth rework validation: targeted retry/upload/job tests passed, `npm run lint`, `npm test` (34 files, 229 tests), `npm run build`, and `git diff --check` passed.
- Fifth rework: retry-exhausted 5xx API errors now preserve `CliError` fields while adding stage context to the final message.
- Fifth rework validation: `npm test -- tests/unit/http.test.ts tests/unit/retry.test.ts`, `npm run lint`, `npm test` (34 files, 229 tests), `npm run build`, and `git diff --check` passed.
- Sixth rework: `jobs wait` now retries staged polling `CliError` values with `status >= 500` and still fails fast on 4xx. Output download callers now share a helper that retries transport failures and HTTP 5xx responses inside `withRetry()` while returning 4xx responses to the existing single-attempt failure path.
- Sixth rework validation: targeted red tests failed before the fix and passed after the fix; `npm test -- tests/integration/jobs-command.test.ts tests/integration/image-remove-watermark-command.test.ts`, `npm run lint`, `npm test` (34 files, 232 tests), `npm run build`, and `git diff --check` passed.
- Sixth rework hosted smoke: whoami/tools list/files upload/markdown upload-images each passed 5 consecutive `--env test` runs using saved CLI config. Smoke observed transient create/complete/upload fetch failures on stderr during upload flows and all recovered.
- Sync: `origin/staging` remained at `5afc5792d905286b6a163fe57482cf47939e1255` and is still an ancestor of the issue branch, so no rebase was needed.

## Blocker Notes

- No blocker at this point. GitHub fetch had one transient SSL failure; sync will be retried before handoff.
- Initial hosted file upload smoke used a `.txt` input and was rejected by public upload MIME policy; rerun used a supported PNG and passed.
