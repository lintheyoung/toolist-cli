## Summary

Classified as complex because this changes `image remove-watermark-batch` CLI parsing, validation, hosted job inputs, tests, and hosted test smoke.

Gateway dependency status:
- DED-34 is Done.
- DED-33 has an unblock comment confirming the test hosted contract exposes `threshold`, `region`, `fallback_region`, `snap`, `snap_max_size`, `snap_threshold`, `denoise`, `sigma`, `strength`, `radius`, and `force`.

Intended change:
- Add optional tuning flags only to `toolist image remove-watermark-batch`.
- Keep no-flag request bodies unchanged.
- Validate obvious invalid CLI values before sending requests.
- Send provided tuning fields in every chunk job input alongside `input_file_id`.

## Commands Run

- `git fetch origin staging && git switch -c symphony/DED-33-remove-watermark-batch-tuning origin/staging`
- `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts` (initial attempt failed: `vitest` missing)
- `npm ci`
- `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts` (RED: 4 expected failures for missing tuning support)
- `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts` (GREEN: 11 passed)
- `npm run lint`
- `npm test`
- `npm run build`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js image remove-watermark-batch --inputs .tmp/ded-33-smoke/image-1.png .tmp/ded-33-smoke/image-2.png --force --region 'br:0,0,160,160' --denoise ai --sigma 50 --strength 300 --threshold 0.4 --snap --snap-max-size 160 --snap-threshold 0.6 --radius 12 --env test --config-path /Users/dede/.config/toollist/config.json --json`
- `node dist/cli.js tools list --env test --config-path /Users/dede/.config/toollist/config.json --json` schema check
- `git fetch origin staging && git rebase origin/staging`
- Post-sync `npm run lint`
- Post-sync `npm test`
- Post-sync `npm run build`
- Post-sync hosted create-job smoke with the same `node dist/cli.js image remove-watermark-batch ... --env test --config-path /Users/dede/.config/toollist/config.json --json` command

## Validation Results

- Focused integration tests pass after implementation.
- `npm run lint`: passed.
- `npm test`: 34 files passed, 236 tests passed.
- `npm run build`: passed.
- Hosted test auth: saved CLI config at `/Users/dede/.config/toollist/config.json`.
- Hosted create-job smoke: created queued test job `job_53e79aba9fd54f0aadf06a6b802fc04f` with tuning flags.
- Hosted test schema exposes the tuning fields for `image.gemini_nb_remove_watermark_batch`.
- Branch was up to date with `origin/staging`; post-sync validation passed:
  - `npm run lint`: passed.
  - `npm test`: 34 files passed, 236 tests passed.
  - `npm run build`: passed.
  - Hosted create-job smoke: created queued test job `job_3d27dfa6885d4dfe85dba67814745cbd` with tuning flags.

## Blockers

- None currently.
