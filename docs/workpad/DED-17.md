# DED-17 Workpad

## Summary

- Add `toolist image remove-background` for single-image background removal jobs.
- Follow the existing `image remove-watermark` behavior for upload, job creation, optional wait, output download, environment resolution, and JSON output.
- The hosted gateway contract in `test` exposes only `input_file_id`; fixed background options are gateway-side defaults for v1.

## Commands Run

- `git status --short --branch`
- `git fetch origin staging`
- `git checkout -b symphony/DED-17-image-remove-background origin/staging`
- `rg --files -g 'package.json' -g 'src/**' -g 'test/**' -g 'tests/**' -g 'docs/**' -g 'README*'`
- `rg -n "remove-watermark|ImageRemoveWatermark|parse.*Image|imageRemove" src/cli.ts`
- `npm test -- tests/integration/image-remove-background-command.test.ts` (initially failed before `npm install`: `vitest: command not found`)
- `npm install`
- RED: `npm test -- tests/integration/image-remove-background-command.test.ts`
- GREEN: `npm test -- tests/integration/image-remove-background-command.test.ts`
- GREEN: `npm test -- tests/integration/image-remove-watermark-command.test.ts tests/integration/image-remove-background-command.test.ts`
- GREEN: `npm run lint`
- `node dist/cli.js whoami --env test --json`
- `node dist/cli.js tools list --env test --json`
- GREEN: `npm test -- tests/integration/image-remove-background-command.test.ts`
- GREEN: `npm run lint`
- GREEN: `npm run build`
- `node dist/cli.js image remove-background --env test --input /var/folders/hz/jy0rr39j3xs0lfl8fl37pmyc0000gn/T/toollist-bg-smoke-1776671194916/photo.png --wait --timeout 300 --output /var/folders/hz/jy0rr39j3xs0lfl8fl37pmyc0000gn/T/toollist-bg-smoke-1776671194916/photo-background-removed.png --json`
- `ls -l /var/folders/hz/jy0rr39j3xs0lfl8fl37pmyc0000gn/T/toollist-bg-smoke-1776671194916/photo-background-removed.png`
- GREEN: `npm test`
- GREEN: `npm run lint`
- GREEN: `npm run build`
- GREEN: `npm run verify:pack-install`
- `git fetch origin staging`
- `git rev-list --left-right --count HEAD...origin/staging` reported `2 0`
- Post-sync GREEN: `npm run lint`
- Post-sync GREEN: `npm test`
- Post-sync GREEN: `npm run build`
- Post-sync GREEN: `git diff --check origin/staging...HEAD`
- Post-sync GREEN: `npm run verify:pack-install`

## Validation Results

- RED: `image remove-background` integration suite failed because the command was not implemented or listed in help.
- GREEN: `image remove-background` integration suite passed with 6 tests.
- GREEN: new command suite plus existing `image remove-watermark` suite passed with 11 tests.
- GREEN: `npm run lint` passed.
- Hosted test auth is available (`whoami --env test` succeeded).
- Hosted test exposes `image.remove_background` version `2026-04-20`; its input schema has `additionalProperties: false` and only accepts `input_file_id`.
- GREEN: after matching the hosted schema, `image remove-background` integration suite passed with 6 tests.
- GREEN: after matching the hosted schema, `npm run lint` passed.
- GREEN: after matching the hosted schema, `npm run build` passed.
- GREEN: hosted `--env test` smoke passed. Job `job_1f1c00338ca9493885f4e958ddb0af65` succeeded for `image.remove_background` version `2026-04-20` and downloaded `photo-background-removed.png` (564 bytes).
- GREEN: full `npm test` passed with 28 files and 165 tests.
- GREEN: full `npm run lint` passed.
- GREEN: full `npm run build` passed.
- GREEN: `npm run verify:pack-install` passed.
- Sync: branch was current with `origin/staging` and only ahead by local commits (`2 0`).
- GREEN: post-sync `npm run lint` passed.
- GREEN: post-sync `npm test` passed with 28 files and 165 tests.
- GREEN: post-sync `npm run build` passed.
- GREEN: post-sync `git diff --check origin/staging...HEAD` passed.
- GREEN: post-sync `npm run verify:pack-install` passed.

## Blockers

- None currently.
