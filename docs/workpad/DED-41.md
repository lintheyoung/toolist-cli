## Summary

Classified as complex because this adds a hosted Toolist CLI command, parser/help wiring, job creation, wait/download behavior, tests, packaging validation, and a required `--env test` hosted smoke.

Dependency status:
- DED-40 is `Done`.
- DED-40 Linear comments record a successful hosted smoke for `image.gpt_image_2_text_to_image` on `test.tooli.st`.

Intended change:
- Add `toolist image gpt-image-2` for Kie GPT Image 2 text-to-image generation.
- Reuse existing API credential resolution for `--env`, `--base-url`, `--token`, and `--config-path`.
- Create jobs with `tool_name: image.gpt_image_2_text_to_image` and input fields `prompt` and `aspect_ratio`.
- Reuse existing stderr progress, retry reporting, job wait, job failure formatting, and output download behavior.

## Commands Run

- `git status --short --branch`
- `git fetch origin staging`
- `git checkout -B symphony/DED-41-gpt-image-2 origin/staging`
- `npm test -- tests/integration/image-gpt-image-2-command.test.ts` (dependency check failed: `vitest` missing)
- `npm ci`
- `npm test -- tests/integration/image-gpt-image-2-command.test.ts` (RED: 5 expected failures for missing command)
- `npm test -- tests/integration/image-gpt-image-2-command.test.ts` (GREEN: 5 passed)
- `npm run lint`
- `npm test`
- `npm run build`
- `/Users/dede/Downloads/toollist/toolist-symphony/scripts/check_cli_hosted_smoke_env.py`
- `node dist/cli.js image gpt-image-2 --prompt "Create a clean 1K square Toolist backend smoke test image with simple geometric shapes." --aspect-ratio 1:1 --wait --timeout 900 --output /tmp/toolist-kie-gpt-image-2-test.png --env test --config-path /Users/dede/.config/toollist/config.json --json`
- `npm run verify:pack-install`
- `ls -l /tmp/toolist-kie-gpt-image-2-test.png && file /tmp/toolist-kie-gpt-image-2-test.png`
- `git fetch origin staging && git rebase origin/staging` (already up to date)
- Post-sync `npm run lint`
- Post-sync `npm test`
- Post-sync `npm run build`
- Post-sync `npm run verify:pack-install`
- Post-sync `node dist/cli.js image gpt-image-2 --prompt "Create a clean 1K square Toolist backend smoke test image with simple geometric shapes." --aspect-ratio 1:1 --wait --timeout 900 --output /tmp/toolist-kie-gpt-image-2-test-post-sync.png --env test --config-path /Users/dede/.config/toollist/config.json --json`
- `ls -l /tmp/toolist-kie-gpt-image-2-test-post-sync.png && file /tmp/toolist-kie-gpt-image-2-test-post-sync.png`

## Validation Results

- Focused integration tests pass: 5 tests passed.
- `npm run lint`: passed.
- `npm test`: 36 files passed, 250 tests passed.
- `npm run build`: passed.
- Hosted smoke auth: saved CLI config at `/Users/dede/.config/toollist/config.json`.
- Hosted GPT Image 2 smoke passed with job `job_3aa11b54390e4bef869a199aaa770ba7`.
- Hosted result belongs to `toollist-staging`.
- Output file exists at `/tmp/toolist-kie-gpt-image-2-test.png`.
- Downloaded output file is a PNG image, 1254 x 1254, 964038 bytes.
- `npm run verify:pack-install`: passed.
- Branch was up to date with `origin/staging`; post-sync validation passed:
  - `npm run lint`: passed.
  - `npm test`: 36 files passed, 250 tests passed.
  - `npm run build`: passed.
  - `npm run verify:pack-install`: passed.
  - Hosted GPT Image 2 smoke passed with job `job_59deee0badd34e188da0202ee9ac51c9`.
  - Hosted result belongs to `toollist-staging`.
  - Output file exists at `/tmp/toolist-kie-gpt-image-2-test-post-sync.png`.
  - Downloaded output file is a PNG image, 1254 x 1254, 814212 bytes.

## Blockers

- None.
