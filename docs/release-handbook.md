# Release Handbook

This handbook captures the minimum steps required to turn the local
`toolist-cli` repository into a public GitHub repository and publish it to npm.

## Current status

The repository is already prepared for:

- local `npm test`
- local `npm run build`
- local `npm pack --dry-run`
- GitHub Actions based publish on release publication

## Before the first public publish

1. Create the remote GitHub repository.
2. Add the GitHub remote locally.
3. Update `package.json` metadata with the real repository URLs:
   - `repository`
   - `homepage`
   - `bugs`
4. Push the repository to GitHub.
5. Add `NPM_TOKEN` to the GitHub repository secrets.
6. Create a GitHub release or run the publish workflow manually.

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
npm test
npm run build
npm pack --dry-run
```

Expected:

- tests pass
- TypeScript build passes
- the packed artifact contains `dist/cli.js`, `README.md`, and `LICENSE`

## GitHub Actions publishing

The repository includes `.github/workflows/release.yml`.

It will:

1. install dependencies
2. run tests
3. build
4. verify the npm package contents
5. publish to npm using `NPM_TOKEN`

## Notes

- `prepack` already ensures a fresh build before packing or publishing.
- `dist/` is intentionally ignored in git and generated at release time.
- If the npm package name `toolist-cli` is not available publicly, switch to a scoped name such as `@toolist/cli` before the first publish.
