# DED-35 Wait For Output File ID Plan

## Goal

Make `toolist image remove-watermark-batch --wait --output` tolerate the race where the job reaches `succeeded` before `result.output.outputFileId` is visible in job detail.

## Implementation Tasks

1. Add failing coverage in `tests/integration/image-remove-watermark-batch-command.test.ts` for delayed output visibility, timeout diagnostics, no-refresh when the current job already has `outputFileId`, and transient refresh retry.
2. Add a reusable helper under `src/lib/` that extracts `result.output.outputFileId`, refreshes `/api/v1/jobs/:id` with staged retry, and sleeps between polls until timeout.
3. Update `src/commands/image/remove-watermark-batch.ts` so the chunk output download path calls the helper and formats missing-output failures with chunk index, job id, status, and a bounded final job snippet.
4. Run the focused integration test, then lint/build/full tests.
5. Build the CLI and run hosted `--env test` smoke for `image remove-watermark-batch --wait --output`.
6. Sync with `origin/staging`, rerun validation, push the branch, create/update the PR, add the Linear handoff comment, and move the issue to Code Review.

## Validation Targets

- `npm test -- tests/integration/image-remove-watermark-batch-command.test.ts`
- `npm run lint`
- `npm test`
- `npm run build`
- `node dist/cli.js image remove-watermark-batch --wait --output ... --env test`
