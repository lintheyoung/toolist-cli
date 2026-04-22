# DED-29 Workpad

## Summary

Add retry behavior to the `files upload` presigned PUT phase. The intended behavior is to reuse the existing network retry budget of 3 total attempts with 1s / 3s backoff, while preserving the current upload JSON output and existing create/complete retry behavior.

## Intended change

- Wrap the presigned PUT request in retry handling.
- Retry transient fetch failures and 5xx upload responses.
- Do not retry 4xx upload responses.
- Preserve final stage context for exhausted transport failures: `Upload request failed: fetch failed`.
- Keep the current clear upload failure for non-retryable non-OK responses.
- Do not add stderr retry notices in this change because `uploadCommand()` has no stderr writer dependency; keep retry behavior and context scoped to the upload layer.

## Commands run

- `sed -n '1,220p' /Users/dede/.codex/superpowers/skills/using-superpowers/SKILL.md`
- `sed -n '1,220p' /Users/dede/.codex/superpowers/skills/test-driven-development/SKILL.md`
- `sed -n '1,180p' /Users/dede/.codex/superpowers/skills/systematic-debugging/SKILL.md`
- `sed -n '1,220p' /Users/dede/.codex/superpowers/skills/verification-before-completion/SKILL.md`
- `sed -n '1,220p' /Users/dede/.codex/superpowers/skills/brainstorming/SKILL.md`
- `sed -n '1,220p' /Users/dede/.codex/superpowers/skills/using-git-worktrees/SKILL.md`
- `git status --short --branch`
- `git remote -v`
- `git fetch origin staging`
- `git switch -c symphony/DED-29-presigned-put-retry origin/staging`
- `sed -n '1,260p' src/commands/files/upload.ts`
- `sed -n '1,760p' tests/integration/files-upload-command.test.ts`
- `sed -n '1,260p' src/lib/retry.ts`
- `sed -n '1,220p' src/lib/http.ts`
- `rg "withStageContext|NETWORK_RETRY|retry" src tests -n`
- `cat package.json`
- `npm test -- tests/integration/files-upload-command.test.ts` (blocked initially by missing `vitest`)
- `npm ci`
- `npm test -- tests/integration/files-upload-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `python3 /Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js files upload --input /var/folders/hz/jy0rr39j3xs0lfl8fl37pmyc0000gn/T/tmp.Anu6l37cMg/smoke.png --public --env test --config-path /Users/dede/.config/toollist/config.json --json`
- `node dist/cli.js markdown upload-images --input /var/folders/hz/jy0rr39j3xs0lfl8fl37pmyc0000gn/T/tmp.Anu6l37cMg/input.md --output /var/folders/hz/jy0rr39j3xs0lfl8fl37pmyc0000gn/T/tmp.Anu6l37cMg/output.md --public --env test --config-path /Users/dede/.config/toollist/config.json --json`

## Validation results

- Initial focused test run could not execute because dependencies were not installed: `vitest: command not found`.
- After `npm ci`, the focused suite failed before implementation as expected: presigned PUT transport retry success, retry exhaustion call count, and 5xx retry success were red.
- After implementation, `npm test -- tests/integration/files-upload-command.test.ts` passed: 1 file, 13 tests.
- `npm run lint`: passed.
- `npm test`: passed, 32 files and 215 tests.
- `npm run build`: passed.
- Hosted smoke auth helper: `status: ok`, `auth_mode: config`, `environment: test`, config path `/Users/dede/.config/toollist/config.json`.
- Hosted smoke `files upload --public --env test`: passed; returned `file.status: uploaded` and a public test image URL.
- Hosted smoke `markdown upload-images --input --output --public --env test`: passed; uploaded 1 local image and rewrote the Markdown output to `https://img-test.tooli.st/...`.

## Blockers

- None.
