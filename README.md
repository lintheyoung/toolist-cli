# Toollist CLI

Toollist CLI is the standalone, agent-first command-line interface for the Toollist platform.

## Install

Run it without installing anything:

```bash
npx toollist@latest --help
```

Install it globally:

```bash
npm i -g toollist
toollist --help
```

## Usage

Authenticate with the platform:

```bash
npx toollist@latest login --base-url https://api.example.com
```

Inspect your current identity:

```bash
npx toollist@latest whoami
```

Run a high-level image conversion:

```bash
npx toollist@latest image convert --input ./photo.jpg --to webp --wait
```

## Development

```bash
npm install
npm test
npm run build
```

After building, the executable is available at `dist/cli.js`.

## Release

See [docs/release-handbook.md](./docs/release-handbook.md) for the checklist to
push this repo to GitHub and publish it to npm.

Released under the MIT License.
