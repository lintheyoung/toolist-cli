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

## Validation Results

- `npm run lint`: passed.
- `npm test`: 34 files, 226 tests passed.
- `npm run build`: passed.
- Hosted smoke helper: `status: ok`, `auth_mode: config`, test config path `/Users/dede/.config/toollist/config.json`.
- Hosted smoke: whoami/tools list/files upload/markdown upload-images each passed 5 consecutive `--env test` runs.
- Hosted smoke observability evidence: transient `Whoami request failed: fetch failed` and `Create upload request failed: fetch failed` both emitted retry lines to stderr and recovered.

## Blocker Notes

- No blocker at this point. GitHub fetch had one transient SSL failure; sync will be retried before handoff.
- Initial hosted file upload smoke used a `.txt` input and was rejected by public upload MIME policy; rerun used a supported PNG and passed.
