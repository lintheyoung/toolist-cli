# DED-28 Workpad

## Summary

Add staged retry behavior to `files upload` API phases while preserving the current JSON output shape. The focused change is to use the existing network retry helper for create and complete upload API requests, with stage-specific error messages retained after retry exhaustion. Presigned PUT uploads keep their current stage context.

## Intended change

- Add retry options to `Create upload request failed` and `Complete upload request failed` API calls.
- Use the existing retry constants: 3 attempts total with 1s / 3s backoff.
- Add tests for complete retry success, complete retry exhaustion, create retry success, create retry exhaustion, and existing presigned PUT stage context.

## Commands run

- `git status --short --branch`
- `git remote -v`
- `git log --oneline --decorate -5`
- `rg --files`
- `git fetch origin staging`
- `git switch -c symphony/DED-28-files-upload-retry-context origin/staging`
- `sed -n '1,260p' src/commands/files/upload.ts`
- `sed -n '1,260p' src/lib/retry.ts`
- `sed -n '1,320p' tests/integration/files-upload-command.test.ts`
- `sed -n '1,260p' tests/integration/files-upload-public-command.test.ts`
- `sed -n '321,760p' tests/integration/files-upload-command.test.ts`
- `sed -n '1,260p' src/lib/http.ts`
- `sed -n '1,280p' tests/unit/retry.test.ts`
- `sed -n '1,300p' tests/unit/http.test.ts`
- `rg "withRetry|NETWORK_RETRY|stage:" -n src tests`
- `cat package.json`
- `cat vitest.config.ts`
- `rg "useFakeTimers|advanceTimers|runAllTimers|sleep" -n tests src`
- `sed -n '1,240p' src/commands/image/convert.ts`
- `npm test -- tests/integration/files-upload-command.test.ts`
- `npm ci`
- `npm test -- tests/integration/files-upload-command.test.ts`
- `npm test -- tests/integration/files-upload-command.test.ts tests/integration/files-upload-public-command.test.ts tests/integration/image-remove-watermark-batch-command.test.ts`
- `npm run lint`
- `npm test`
- `python3 /Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `npm run build`
- `node dist/cli.js files upload --input "$tmp_dir/smoke.png" --public --env test --config-path /Users/dede/.config/toollist/config.json --json`
- `node dist/cli.js markdown upload-images --input "$tmp_dir/input.md" --output "$tmp_dir/output.md" --public --env test --config-path /Users/dede/.config/toollist/config.json --json`

## Validation results

- Initial targeted test run failed as expected before implementation: complete stage `fetch failed` was wrapped without retry.
- After implementation, targeted upload-related tests passed: 3 files, 19 tests.
- `npm run lint`: passed.
- `npm test`: passed, 32 files and 212 tests.
- Hosted smoke auth helper: `status: ok`, `auth_mode: config`, `environment: test`, config path `/Users/dede/.config/toollist/config.json`.
- Hosted smoke `files upload --public --env test`: passed; returned `file.status: uploaded` and a public test image URL.
- Hosted smoke `markdown upload-images --input --output --public --env test`: passed; uploaded 1 local image and rewrote the Markdown output to `https://img-test.tooli.st/...`.

## Blockers

- None.
