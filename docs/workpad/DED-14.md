# DED-14 Workpad

## Summary

- Add `toolist document docx-to-markdown` for single DOCX to Markdown bundle jobs.
- Add `toolist document docx-to-markdown-batch` for multiple DOCX inputs zipped before job creation.
- Follow the existing async image command behavior for upload, create job, optional wait, output download, environment resolution, and JSON output.

## Commands Run

- `git status --short --branch`
- `rg --files`
- `npm test -- tests/integration/document-docx-to-markdown-command.test.ts`
- `npm test -- tests/integration/files-upload-command.test.ts --runInBand` (failed: Vitest does not support Jest's `--runInBand` flag)
- `npm test -- tests/integration/files-upload-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `node dist/cli.js whoami --env test`
- `node dist/cli.js document docx-to-markdown --env test --input /tmp/toollist-docx-smoke.30ztZL/sample1.docx --wait --timeout 240 --output /tmp/toollist-docx-smoke.30ztZL/bundle.zip`
- `node dist/cli.js document docx-to-markdown-batch --env test --inputs /tmp/toollist-docx-smoke.30ztZL/sample1.docx /tmp/toollist-docx-smoke.30ztZL/sample2.docx --wait --timeout 240 --output /tmp/toollist-docx-smoke.30ztZL/results.zip`
- `git fetch origin staging`
- `git rev-list --left-right --count HEAD...origin/staging`
- `git diff --check`
- Post-sync `npm run lint`
- Post-sync `npm test`
- Post-sync `npm run build`

## Validation Results

- RED: document command tests fail because the `document` CLI group and command module are not implemented yet.
- GREEN: document command suite passes after adding the command modules and CLI routing.
- GREEN: files upload suite passes after adding DOCX MIME inference.
- GREEN: `npm run lint` passed.
- GREEN: `npm test` passed with 27 files and 158 tests.
- GREEN: `npm run build` passed.
- Sync: branch started from the latest `origin/staging` (`git rev-list --left-right --count HEAD...origin/staging` reported `0 0` before committing local changes).
- GREEN: `git diff --check` passed.
- GREEN: post-sync `npm run lint` passed.
- GREEN: post-sync `npm test` passed with 27 files and 158 tests.
- GREEN: post-sync `npm run build` passed.
- Hosted test auth is available (`whoami --env test` succeeded), but hosted smoke is blocked by gateway-side readiness:
  - Single DOCX upload failed with `File MIME type 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' is not supported by the public upload policy.`
  - Batch job creation failed with `Tool 'document.docx_to_markdown_bundle_batch' was not found.`

## Blockers

- Hosted test environment does not yet accept DOCX uploads and does not yet expose `document.docx_to_markdown_bundle_batch`.
