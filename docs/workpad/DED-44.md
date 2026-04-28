# DED-44 Workpad

## Summary
Add `toolist twitter watch poll --remote` and `toolist twitter watch trust` for local execution of remote Twitter watch events with a local trust gate.

## Intended Change
- Add Twitter watch command routing and help text.
- Add a command module that fetches remote watches, polls each watch, suppresses baseline events, gates command execution on local trust, renders tweet variables, executes local commands, and reports execution status.
- Add local trust file support keyed by watch id and command hash.
- Add integration/unit coverage for help, remote fetch/poll behavior, baseline suppression, untrusted/trusted execution, and command failure reporting.

## Commands Run
- `git fetch origin staging`
- `git checkout -B symphony/DED-44-twitter-watch-poll-remote origin/staging`
- `npm install`
- `npm test -- tests/integration/twitter-watch-command.test.ts` (red: missing `src/commands/twitter/watch.js` before implementation)
- `npm test -- tests/integration/twitter-watch-command.test.ts` (green)
- `npm test -- tests/integration/twitter-watch-command.test.ts tests/integration/whoami-command.test.ts tests/integration/jobs-command.test.ts tests/unit/cli-root.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `node dist/cli.js twitter watch --help`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js twitter watch poll --remote --once --env test --config-path /Users/dede/.config/toollist/config.json --json`
- Endpoint probe for `GET https://test.tooli.st/api/cli/twitter/watch/remote`

## Validation Results
- 2026-04-27 rework hosted-smoke credential refresh:
  - `npm run build` -> passed.
  - `node dist/cli.js whoami --env test --config-path /Users/dede/.config/toollist/config.json --json` before refresh -> token scopes were `workspace:read`, `tools:read`, `files:read`, `files:write`, `jobs:read`, `jobs:write`.
  - `node dist/cli.js login --env test --config-path /Users/dede/.config/toollist/config.json --client-name "DED-44 hosted smoke" --json` -> refreshed saved test profile for `lintheyoungisme@gmail.com`.
  - `node dist/cli.js whoami --env test --config-path /Users/dede/.config/toollist/config.json --json` after refresh -> token scopes include `twitter-watches:read` and `twitter-watches:write`.
  - `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py` -> `status: ok`, `auth_mode: config`, test config at `/Users/dede/.config/toollist/config.json`.
  - `node dist/cli.js twitter watch poll --remote --once --env test --config-path /Users/dede/.config/toollist/config.json --json` -> exit 1 after retries, stderr `Twitter remote watches request failed: An unexpected error occurred.`
  - Sanitized direct endpoint probe with refreshed test profile: `GET https://test.tooli.st/api/v1/twitter-public-watches` -> HTTP 500 JSON `INTERNAL_UNEXPECTED_ERROR`, request id `9ea253d6-7e06-40ed-9e4d-560fc3d1314e`.
  - Sanitized direct auth probe with refreshed test profile: `GET https://test.tooli.st/api/cli/me` -> HTTP 200 with `twitter-watches:read` and `twitter-watches:write` present.
  - `git fetch origin staging`; `git merge-base --is-ancestor origin/staging HEAD` -> branch contains latest `origin/staging`.
  - `npm test -- tests/integration/twitter-watch-command.test.ts tests/integration/whoami-command.test.ts tests/integration/jobs-command.test.ts tests/unit/cli-root.test.ts` -> 4 files, 33 tests passed.
  - `node dist/cli.js twitter watch --help && node dist/cli.js twitter watch poll --help && node dist/cli.js twitter watch trust --help` -> printed poll/trust help.
  - `npm test` -> 37 files, 257 tests passed.
  - `npm run lint` -> passed.
  - `npm run build` -> passed.
- 2026-04-27 rework for DED-43 contract mismatch:
  - `npm test -- tests/integration/twitter-watch-command.test.ts` -> red before implementation: old `/api/cli/...` paths, old event parsing, and old execution report status/path failed against DED-43 expectations.
  - Verified DED-43 route source from `lintheyoung/toollist-gateway-app` staging: `GET /api/v1/twitter-public-watches`, `POST /api/v1/twitter-public-watches/:watchId/poll`, and `POST /api/v1/twitter-public-watches/events/:eventId/execution`; execution body schema accepts `status`, `stdout`, `stderr`, and `exitCode`.
  - `npm test -- tests/integration/twitter-watch-command.test.ts` -> 1 file, 7 tests passed after rework.
  - `npm test -- tests/integration/twitter-watch-command.test.ts tests/integration/whoami-command.test.ts tests/integration/jobs-command.test.ts tests/unit/cli-root.test.ts` -> 4 files, 33 tests passed.
  - `npm test` -> 37 files, 257 tests passed.
  - `npm run lint` -> passed.
  - `npm run build` -> passed.
  - `node dist/cli.js twitter watch --help && node dist/cli.js twitter watch poll --help && node dist/cli.js twitter watch trust --help` -> printed poll/trust help.
  - `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py` -> `status: ok`, `auth_mode: config`, test config at `/Users/dede/.config/toollist/config.json`.
  - `node dist/cli.js twitter watch poll --remote --once --env test --config-path /Users/dede/.config/toollist/config.json --json` -> exit 1, stderr `An unexpected error occurred.`
  - Sanitized direct endpoint probe with saved test profile: `GET https://test.tooli.st/api/v1/twitter-public-watches` -> HTTP 404, `content-type: text/html; charset=utf-8`.
  - Post-sync `git fetch origin staging && git rebase origin/staging` -> branch already up to date.
  - Post-sync `npm test -- tests/integration/twitter-watch-command.test.ts tests/integration/whoami-command.test.ts tests/integration/jobs-command.test.ts tests/unit/cli-root.test.ts` -> 4 files, 33 tests passed.
  - Post-sync `npm test` -> 37 files, 257 tests passed.
  - Post-sync `npm run lint && npm run build` -> passed.
  - Post-sync hosted smoke repeated the same blocker: built CLI exits 1; sanitized endpoint probe still returns HTTP 404.
- 2026-04-27 current pass after sync with `origin/staging`:
  - `git fetch origin staging && git rebase origin/staging` -> up to date.
  - `npm test -- tests/integration/twitter-watch-command.test.ts tests/integration/whoami-command.test.ts tests/integration/jobs-command.test.ts tests/unit/cli-root.test.ts` -> 4 files, 33 tests passed.
  - `npm test` -> 37 files, 257 tests passed.
  - `npm run lint` -> passed.
  - `npm run build` -> passed.
  - `node dist/cli.js twitter watch --help && node dist/cli.js twitter watch poll --help && node dist/cli.js twitter watch trust --help` -> printed poll/trust help.
  - `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py` -> `status: ok`, `auth_mode: config`, test config at `/Users/dede/.config/toollist/config.json`.
  - `node dist/cli.js twitter watch poll --remote --once --env test --config-path /Users/dede/.config/toollist/config.json --json` -> exit 1, stderr `An unexpected error occurred.`
  - Endpoint probe with saved test token: `GET https://test.tooli.st/api/cli/twitter/watch/remote` -> HTTP 404, `content-type: text/html; charset=utf-8`.

## Blockers
- 2026-04-27 rework hosted smoke: The saved test CLI credentials were refreshed and now include `twitter-watches:read` / `twitter-watches:write`, but the test Gateway route `GET /api/v1/twitter-public-watches` returns HTTP 500 JSON `INTERNAL_UNEXPECTED_ERROR` for the authenticated user. Hosted `--env test` smoke still cannot validate the full remote watch polling path until Gateway test resolves that server error.
- 2026-04-27 rework: Test Gateway does not currently expose `GET /api/v1/twitter-public-watches` on `https://test.tooli.st` despite the route existing on `toollist-gateway-app` staging. Hosted `--env test` smoke still cannot validate the remote watch contract.
- Previous blocker: Test Gateway did not expose `GET /api/cli/twitter/watch/remote`; the CLI no longer calls that retired path after rework.

## Implementation Notes
- MVP intentionally supports `--once`; `--interval` remains out of scope for this first implementation.
- Tweet variable substitutions are shell-quoted before local execution to reduce command-injection risk from public tweet content.
- `npm test` → 37 files, 257 tests passed.
- `npm run build` → passed.
- `node dist/cli.js twitter watch --help` → printed poll/trust help.
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py` → `status: ok`, `auth_mode: config`, test config at `/Users/dede/.config/toollist/config.json`.
- Hosted smoke with copied config: `node dist/cli.js twitter watch poll --remote --once --env test --config-path <tmp>/config.json --json` → exit 1, stderr `An unexpected error occurred.`
- Endpoint probe: `GET https://test.tooli.st/api/cli/twitter/watch/remote` → HTTP 404, `content-type: text/html; charset=utf-8`.
- `git fetch origin staging && git rebase origin/staging` → branch already up to date.
- Post-sync `npm test` → 37 files, 257 tests passed.
- Post-sync `npm run build` → passed.
- `gh pr checks 28 --watch --interval 10` → no checks reported on branch.
