# DED-18 Workpad

## Summary

Add `toolist markdown upload-images` to upload local Markdown images and frontmatter `coverImage` values through the existing public file upload path, then rewrite Markdown files in place with returned public URLs.

## Intended Change

- Add a markdown command group and `upload-images` subcommand to the CLI.
- Support single-file `--input` and batch `--root` plus `--glob` modes.
- Require `--in-place` and explicit `--public` for MVP safety.
- Reuse existing environment, token, base URL, and config resolution.
- Upload each unique local image path once per run and reuse the same public URL for duplicate references.
- Produce JSON report output by default.

## Commands Run

- `git switch -c symphony/DED-18-markdown-upload-images`
- `npm install`
- `npm test -- tests/integration/markdown-upload-images-command.test.ts`
- `npm run lint`
- `npm test -- tests/unit/cli-root.test.ts tests/integration/files-upload-command.test.ts tests/integration/files-upload-public-command.test.ts`
- `npm test`
- `npm run build`
- `npm run verify:pack-install`
- `node dist/cli.js markdown upload-images --input "$tmpdir/article.md" --in-place --public --env test --json`
- `git fetch origin staging && git rebase origin/staging`
- Post-sync: `npm run lint`
- Post-sync: `npm test`
- Post-sync: `npm run build`
- Post-sync: `npm run verify:pack-install`
- Post-sync: `node dist/cli.js markdown upload-images --input "$tmpdir/article.md" --in-place --public --env test --json`
- Final self-review: `git diff --check origin/staging...HEAD`
- Final self-review: `npm test -- tests/integration/markdown-upload-images-command.test.ts && npm run lint`
- Final self-review: `npm test`
- Final self-review: `npm run build && npm run verify:pack-install`
- Final self-review: `node dist/cli.js markdown upload-images --input "$tmpdir/article.md" --in-place --public --env test --json`

## Validation Results

- New command targeted tests: 5 passed.
- TypeScript lint: passed.
- Existing root/files upload regression slice: 9 passed.
- Full test suite: 29 files passed, 170 tests passed.
- Build: passed.
- Packaged install verification: passed.
- Hosted smoke: passed against `--env test`, uploading a temporary Markdown image and rewriting it to `https://img-test.tooli.st/public/files/file_a275de7c5b2d4369bb6ecbcca6fce6e3/8a458eb38c9c481c814faf11999b24d2.png`.
- Staging sync: branch was already up to date with `origin/staging`.
- Post-sync TypeScript lint: passed.
- Post-sync full test suite: 29 files passed, 170 tests passed.
- Post-sync build: passed.
- Post-sync packaged install verification: passed.
- Post-sync hosted smoke: passed against `--env test`, uploading a temporary Markdown image and rewriting it to `https://img-test.tooli.st/public/files/file_c191c6e6dde340bcbbbd4b409b11bba0/433fde3ed82b4d9e9d1302596b779f14.png`.
- Final diff whitespace check: passed.
- Final targeted command tests: 5 passed.
- Final TypeScript lint: passed.
- Final full test suite: 29 files passed, 170 tests passed.
- Final build and packaged install verification: passed.
- Final hosted smoke: passed against `--env test`, uploading a temporary Markdown image and rewriting it to `https://img-test.tooli.st/public/files/file_4a8c62d39a4d48e69da55102b6ea57ce/540aebc2536644f7b6319f92371fb247.png`.

## Blockers

- None currently.
