# DED-26 Markdown Upload Images Dry Run and Skip Missing Plan

## Goal

Add `--dry-run` and `--skip-missing` to `toolist markdown upload-images` without regressing existing upload, rewrite, report, and deduplication behavior.

## Approach

1. Add failing integration coverage for help text, dry-run reporting, default missing failure, skip-missing upload/rewrite behavior, and report file parity.
2. Extend CLI parsing/help to forward `dryRun` and `skipMissing` into the command.
3. Extend command report types and scan validation so missing references are reported when requested and still fail by default.
4. Add an early dry-run return after scanning and existence checks, before uploads and writes.
5. In the upload loop, skip missing references only when `skipMissing` is set.
6. Run targeted integration tests, then full lint/test/build/package verification.

## Validation

Required commands:
- `npm test -- tests/integration/markdown-upload-images-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run verify:pack-install`

Hosted smoke:
- Not required for this ticket because the new behavior is local scan/report/write control and dry-run explicitly avoids uploads.
