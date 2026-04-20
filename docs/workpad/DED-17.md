# DED-17 Workpad

## Summary

- Add `toolist image remove-background` for single-image background removal jobs.
- Follow the existing `image remove-watermark` behavior for upload, job creation, optional wait, output download, environment resolution, and JSON output.
- First version sends fixed gateway options: `background_type: "rgba"`, `format: "png"`, `threshold: 0`, `reverse: false`.

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

## Validation Results

- RED: `image remove-background` integration suite failed because the command was not implemented or listed in help.
- GREEN: `image remove-background` integration suite passed with 6 tests.
- GREEN: new command suite plus existing `image remove-watermark` suite passed with 11 tests.
- GREEN: `npm run lint` passed.

## Blockers

- None currently.
