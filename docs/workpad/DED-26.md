# DED-26 Workpad

## Summary

Add `--dry-run` and `--skip-missing` to `toolist markdown upload-images`.

Implementation approach:
- Keep `--public` and `--in-place` as required safety flags for now, including dry-run.
- Extend the scan phase to produce per-reference local image status.
- Default behavior still throws on missing local images before upload.
- `--dry-run` returns JSON only after scan and existence checks; it does not upload or write Markdown.
- `--skip-missing` omits missing references from the upload/rewrite loop while preserving the original Markdown references.

## Commands Run

- `git status --short --branch`
- `git fetch origin staging`
- `npm ci`
- `npm test -- tests/integration/markdown-upload-images-command.test.ts` (first runnable pass failed as expected: new flags/behaviors missing)
- `npm test -- tests/integration/markdown-upload-images-command.test.ts`
- `npm run lint`

## Validation Results

- `npm test -- tests/integration/markdown-upload-images-command.test.ts`: pass, 11 tests.
- `npm run lint`: pass.

## Blockers

- None.
