# DED-31 Retry Observability Plan

## Goal

Make transient fetch retries visible on stderr and ensure common Gateway API reads have retry plus stage context without polluting JSON stdout.

## Implementation Tasks

1. Add failing unit tests for `withRetry()` `onRetry` events, retry notice formatting, and retryable transport error classification.
2. Add failing unit tests for `apiRequest()` retrying staged transport failures with `onRetry`, retrying staged 5xx fetch responses, and not retrying 4xx responses.
3. Add failing integration/unit coverage for upload create/PUT/complete retry stderr behavior, whoami retry success, tools list retry success, and final staged failure messages.
4. Implement retry callback types, stderr formatting helpers, transport classification, and extended retry constants.
5. Update `apiRequest()` to use retry classification for transport and 5xx responses when retry options are supplied.
6. Thread optional retry callbacks through CLI command args and dependencies for upload, whoami, tools list, jobs get/wait, job output download, and hosted tool commands.
7. Keep create-job retry at the existing 3-attempt window while passing retry observability through it.
8. Run targeted tests first, then broader unit/integration checks and hosted `--env test` smoke commands.

## Validation Targets

- `npm test -- tests/unit/retry.test.ts tests/unit/http.test.ts`
- Targeted integration tests covering files upload, whoami, tools list, and jobs.
- Hosted smokes for:
  - `files upload --public --env test`
  - `markdown upload-images --public --env test`
  - `whoami --env test --json`
  - `tools list --env test --json`
