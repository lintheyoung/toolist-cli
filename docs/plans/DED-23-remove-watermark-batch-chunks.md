# DED-23 Remove Watermark Batch Chunks Plan

## Goal

Build chunked execution into `toolist image remove-watermark-batch` so the CLI submits at most 5 files per hosted job and merges successful chunk outputs into one final ZIP.

## Approach

1. Add tests first for:
   - `--chunk-size` help and validation.
   - 30 inputs creating 6 jobs by default.
   - `--chunk-size 3` creating 10 jobs for 30 inputs.
   - each generated chunk ZIP containing no more than the requested chunk size.
   - final output ZIP using `chunk-001/` style paths and a top-level `manifest.json`.
   - chunk failure stderr containing chunk index, input count, job id, error code, error message, and external task id.
2. Extend ZIP helpers so callers can resolve ordered input paths once, write chunk ZIPs, read stored result ZIP entries, and write merged stored ZIPs.
3. Add a focused `zip-merge` helper that merges chunk outputs under deterministic chunk directories and writes an aggregate manifest.
4. Update `remove-watermark-batch.ts` to orchestrate chunk creation, upload, job creation, wait, download, merge, cleanup, and summary return values.
5. Extend the progress reporter with chunk preparation, saved chunk output, and merge progress methods while preserving silent defaults.
6. Add CLI parsing and help for `--chunk-size`.
7. Run focused tests, lint, full tests, build, pack verification, sync with `origin/staging`, rerun validation, run or block hosted test smoke, push, PR, and Linear handoff.

## Files

- Modify `src/cli.ts` for help, parsing, validation, and command argument pass-through.
- Modify `src/commands/image/remove-watermark-batch.ts` for chunked orchestration and result summary.
- Modify `src/lib/zip-batch-input.ts` to expose ordered input resolution and reusable ZIP writing.
- Add `src/lib/zip-merge.ts` for stored ZIP reading and merged output writing.
- Modify `src/lib/progress-reporter.ts` for DED-21-compatible chunk progress.
- Update `tests/integration/image-remove-watermark-batch-command.test.ts`.
- Add or update unit coverage around ZIP merge behavior.

## Validation

- `npm test -- tests/unit/zip-batch-input.test.ts tests/unit/zip-merge.test.ts tests/unit/progress-reporter.test.ts tests/integration/image-remove-watermark-batch-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run verify:pack-install`
- Hosted test smoke with `node dist/cli.js image remove-watermark-batch ... --env test --chunk-size 5 --json` when credentials and sample inputs are available.

## Handoff

Target branch: `symphony/DED-23-remove-watermark-chunks`

Target PR base: `staging`
