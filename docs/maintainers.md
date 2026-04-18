# Maintainer Guide

This guide is for Toollist CLI maintainers. It captures the internal release
flow, the required pre-release gates, and how this repository coordinates with
the hosted Toollist platform.

## Branch and Environment Model

- `feature/*` = local development
- `staging` = hosted `test` validation
- `main` = production release branch

Hosted environment targets:

- `prod` -> `https://tooli.st`
- `test` -> `https://test.tooli.st`
- `dev` -> `http://localhost:3024`

## Cross-Repo Changes

If a change affects Toollist web APIs, auth flows, jobs, storage behavior, or
tool contracts, treat it as a cross-repo change.

Expected flow:

1. create matching feature branches in `gateway-app` and `toollist-cli`
2. validate both repos locally
3. merge both repos to `staging`
4. validate CLI against hosted `test` with `--env test`
5. promote the hosted platform first
6. publish the CLI after the hosted platform is ready

The shared platform SOP lives in:

- [Delivery Docs Hub](https://github.com/lintheyoung/toollist-gateway-app/blob/staging/docs/delivery/README.md)
- [One-Page Team Execution Flow](https://github.com/lintheyoung/toollist-gateway-app/blob/staging/docs/delivery/team-execution-one-page.md)
- [Team Delivery SOP](https://github.com/lintheyoung/toollist-gateway-app/blob/staging/docs/toolist-team-delivery-sop.md)
- [Environment Runbook](https://github.com/lintheyoung/toollist-gateway-app/blob/staging/docs/environment-runbook.md)
- [Hosted Test Smoke Checklist](https://github.com/lintheyoung/toollist-gateway-app/blob/staging/docs/test-environment-smoke-checklist.md)
- [Release Checklist](https://github.com/lintheyoung/toollist-gateway-app/blob/staging/docs/release-checklist.md)

## Required Release Gates

Every formal release must pass:

1. `npm run lint`
2. `npm test`
3. `npm run build`
4. `npm run verify:pack-install`
5. `npm run smoke:test`

`verify:pack-install` confirms that the packed tarball installs correctly and
that the shipped CLI entrypoint still works outside the repository checkout.

`smoke:test` runs non-interactive hosted validation against `test.tooli.st`
using a dedicated test token.

## GitHub Workflows

### Pre-release Gate

`.github/workflows/pre-release.yml` is the reusable and manually-runnable gate.

It runs:

- lint
- unit/integration tests
- TypeScript build
- tarball install smoke
- hosted `test` smoke when the test token is available

Use this workflow before cutting a GitHub release if you want a clean
maintainer-only confirmation step.

### Release Publish

`.github/workflows/release.yml` calls the pre-release gate with hosted smoke
required, then publishes to npm.

Release publication should only happen from `main`.

## Required GitHub Secrets

- `NPM_TOKEN`: npm publish token
- `TOOLLIST_TEST_TOKEN`: non-interactive token for hosted `test` smoke

Optional:

- `TOOLLIST_TEST_BASE_URL`: override the hosted test base URL if needed
- `TOOLLIST_TEST_ENV`: override the default hosted environment name (`test`)

## Local Maintainer Commands

Run the full local gate:

```bash
npm run lint
npm test
npm run build
npm run verify:pack-install
```

Run hosted test smoke locally:

```bash
TOOLLIST_TEST_TOKEN=<token> npm run smoke:test
```

## Release Order

If the release depends on hosted platform changes:

1. release `gateway-app` / hosted platform first
2. confirm hosted `test` and `prod` behavior
3. publish `toollist-cli`

Do not publish the CLI first if the production API contract is not already in
place.
