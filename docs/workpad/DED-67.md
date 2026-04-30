# DED-67 — Image Cloudflare `--compress` preset

## Summary
Added `--compress balanced|small|smallest` to Cloudflare image convert/resize/crop commands, including batch variants, and mapped the preset internally to the existing `quality` field. Explicit `--quality` wins when both are supplied.

## Intended change
- Add shared quality resolver for `quality` + `compress`.
- Add parser support for `--compress` on convert/resize/crop single and batch commands.
- Add missing `--quality` passthrough for `resize-batch`.
- Update help and README with preset behavior and recommended WebP usage.

## Commands run
- `git fetch origin staging`
- `npm ci`
- `npm test -- tests/integration/image-convert-command.test.ts tests/integration/image-resize-command.test.ts tests/integration/image-crop-command.test.ts tests/integration/image-convert-batch-command.test.ts tests/integration/image-resize-batch-command.test.ts tests/integration/image-crop-batch-command.test.ts`
- `npm run lint && npm test && npm run build`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js image convert --input ./tmp/ded-67-smoke.png --to webp --compress smallest --sync --wait --output ./tmp/ded-67-smoke.webp --env test --config-path /Users/dede/.config/toollist/config.json --json`

## Validation results
- `npm test -- ...image command tests...`: 6 files passed, 52 tests passed.
- `npm run lint && npm test && npm run build`: passed; full suite 37 files passed, 265 tests passed.
- Hosted test smoke auth helper: `status: ok`, `auth_mode: config`, `base_url: https://test.tooli.st`.
- Hosted test smoke reached hosted job creation/upload but failed downstream with Cloudflare Worker `401` (`PROVIDER_REQUEST_FAILED`) before an output file could be downloaded.

## Blockers
- Hosted test smoke output/download verification is blocked by test gateway/provider auth: Cloudflare Worker request failed with status 401.
