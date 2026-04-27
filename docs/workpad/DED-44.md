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
- Test Gateway does not currently expose `GET /api/cli/twitter/watch/remote`, so hosted `--env test` smoke cannot validate the required remote watch contract yet.

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
