# DED-17 Remove Background Implementation Plan

## Goal

Add `toolist image remove-background` using the hosted `image.remove_background` tool.

## Approach

- Mirror the single-image async flow from `image remove-watermark`.
- Add integration coverage first for help, create job, wait, and output download.
- Keep advanced Replicate options private for v1; the hosted gateway owns those fixed defaults and the CLI only sends `input_file_id`.

## Tasks

1. Add failing integration tests for `image remove-background`.
2. Implement `src/commands/image/remove-background.ts` by adapting the proven upload/job/wait/download pattern.
3. Wire `src/cli.ts` imports, image help text, argument parsing, dedicated help, and routing.
4. Add a README common-command example if the docs section remains small.
5. Run targeted tests, then full lint/test/build/pack verification.
6. Run hosted `--env test` smoke after building, record evidence, then sync with `origin/staging`, push, and open/update PR.
