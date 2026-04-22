# DED-27 Workpad

## Summary

Add non-in-place write targets for `toolist markdown upload-images`:

- `--root ... --output-dir <dir>` writes processed Markdown under a new root while preserving paths relative to `--root`.
- `--input ... --output <path>` writes the processed single file to an explicit path.
- Existing `--in-place` behavior remains supported.
- `--dry-run` uploads nothing and writes no Markdown, but reports where output would be written.
- Reports include per-file output path information.

## Intended Change

- Extend CLI parsing/help with `--output-dir` and `--output`.
- Validate mutually exclusive combinations:
  - `--in-place` with `--output-dir`
  - `--in-place` with `--output`
  - `--output` outside `--input`
  - `--output-dir` outside `--root`
- Require one write mode for normal and dry-run invocations.
- Create output parent directories before writing output Markdown.
- Keep missing local image references unchanged when `--skip-missing` is used.

## Commands Run

- `npm ci`
- `npm test -- tests/integration/markdown-upload-images-command.test.ts` (red: 5 expected missing-feature failures)
- `npm test -- tests/integration/markdown-upload-images-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run verify:pack-install`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js markdown upload-images --input "$tmpdir/article.md" --output "$tmpdir/out/article.md" --public --env test --config-path /Users/dede/.config/toollist/config.json --json`

## Validation Results

- Targeted markdown upload integration: 16 tests passed.
- Full test suite: 32 files passed, 207 tests passed.
- Lint: `tsc --noEmit` passed.
- Build: `tsc -p tsconfig.json` passed.
- Pack/install smoke: `Verified packaged install smoke for toolist-cli-0.1.0.tgz`.
- Hosted smoke: uploaded one test Markdown image through `--env test` using saved CLI config, wrote `output_path`, and left the source Markdown unchanged.

## Blockers

- None.
