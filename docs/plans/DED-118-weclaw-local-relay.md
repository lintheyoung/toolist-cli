# DED-118 WeClaw Local Relay Plan

## Goal

Implement local WeClaw CLI commands for health, binding completion, and relay delivery processing.

## Approach

1. Add failing integration tests in `tests/integration/weclaw-command.test.ts` for the local client and CLI dispatch.
2. Implement `src/lib/weclaw-local.ts` with URL normalization, health checks, send calls, and clear local errors.
3. Implement `src/commands/weclaw/status.ts`, `src/commands/weclaw/bind.ts`, and `src/commands/weclaw/relay.ts`.
4. Wire `src/cli.ts` with `weclaw` help, argument parsing, credential resolution, and progress-to-stderr behavior.
5. Validate with targeted tests first, then lint, build, and hosted smoke checks as required by the ticket.

## Contract

- Local WeClaw health: `GET /health`
- Local WeClaw send: `POST /api/send` with `{ "to", "text", "media_url" }`
- Gateway binding complete: `POST /api/v1/weclaw-bindings/complete`
- Gateway claim: `POST /api/v1/weclaw-deliveries/claim`
- Gateway ack: `POST /api/v1/weclaw-deliveries/:deliveryId/ack`

## Test Slices

- Local client sends the expected request and reports 5xx/network failures.
- `toolist weclaw status --weclaw-url ... --json` emits only final JSON on stdout.
- `toolist weclaw bind` resolves hosted credentials and calls the binding endpoint.
- `toolist weclaw relay --once` claims, sends, and acks `sent`.
- Local WeClaw failure during relay acks `failed` and returns a clear result.
