# Release Handbook

This handbook captures the minimum steps required to turn the local
`toolist-cli` repository into a public GitHub repository and publish it to npm.

## Current status

The repository is already prepared for:

- local `npm run lint`
- local `npm test`
- local `npm run build`
- local packed-install smoke
- hosted `test` smoke
- GitHub Actions based pre-release gate before publish

## Before the first public publish

1. Create the remote GitHub repository.
2. Add the GitHub remote locally.
3. Update `package.json` metadata with the real repository URLs:
   - `repository`
   - `homepage`
   - `bugs`
4. Push the repository to GitHub.
5. Add `NPM_TOKEN` to the GitHub repository secrets.
6. Add `TOOLLIST_TEST_TOKEN` to the GitHub repository secrets.
7. Create a GitHub release or run the publish workflow manually.

## Suggested first-time setup

```bash
cd /Users/dede/Downloads/toollist/toollist-cli

git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## Package metadata to add before publishing

Recommended `package.json` fields once the canonical repo URL exists:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/<owner>/toolist-cli.git"
  },
  "homepage": "https://github.com/<owner>/toolist-cli#readme",
  "bugs": {
    "url": "https://github.com/<owner>/toolist-cli/issues"
  }
}
```

## Local pre-release verification

Run this before pushing a release tag or publishing:

```bash
npm run lint
npm test
npm run build
npm run verify:pack-install
```

Expected:

- TypeScript typecheck passes
- tests pass
- the packed artifact installs cleanly
- the installed CLI prints root help and command help

To run the hosted `test` smoke locally:

```bash
TOOLLIST_TEST_TOKEN=<token> npm run smoke:test
```

This validates the live `test` environment with:

- `whoami`
- `tools list`
- `files upload --public`

## GitHub Actions publishing

The repository includes:

- `.github/workflows/pre-release.yml`
- `.github/workflows/release.yml`

### Pre-release Gate

The pre-release gate runs:

1. install dependencies
2. run lint
3. run tests
4. build
5. verify packed-install smoke
6. run hosted `test` smoke when `TOOLLIST_TEST_TOKEN` is available

### Release Publish

The release workflow calls the pre-release gate with hosted smoke required, then
publishes to npm using `NPM_TOKEN`.

## Notes

- `prepack` already ensures a fresh build before packing or publishing.
- `dist/` is intentionally ignored in git and generated at release time.
- If the npm package name `toolist-cli` is not available publicly, switch to a scoped name such as `@toolist/cli` before the first publish.
