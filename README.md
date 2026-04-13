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

After logging in, commands reuse the saved login automatically. You only need
`--token` when you want to override the saved credentials explicitly.

Inspect your current identity:

```bash
npx toollist@latest whoami
```

Run a high-level image conversion:

```bash
npx toollist@latest image convert --input ./photo.jpg --to webp --wait
```

Resize an image and write the derived artifact locally:

```bash
npx toollist@latest image resize --input ./photo.jpg --width 1200 --to webp --wait --output ./photo-1200.webp
```

Crop an image to a bounding box and download the result:

```bash
npx toollist@latest image crop --input ./photo.jpg --x 120 --y 80 --width 640 --height 480 --to png --wait --output ./photo-crop.png
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
