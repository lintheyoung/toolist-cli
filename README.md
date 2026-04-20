# Toollist CLI

Toollist CLI is the public command-line client for Toollist. It gives you a
fast way to authenticate, upload files, inspect your workspace, and run hosted
Toollist tools from scripts, terminals, and agent workflows.

## Install

Run it without installing anything:

```bash
npx toolist-cli@latest --help
```

Install it globally:

```bash
npm install -g toolist-cli
toolist --help
```

## Quick Start

Authenticate with Toollist:

```bash
npx toolist-cli@latest login
```

Inspect the current identity:

```bash
npx toolist-cli@latest whoami
```

Upload a public file:

```bash
npx toolist-cli@latest files upload --input ./photo.jpg --public --json
```

## Hosted Environments

Toollist CLI has three built-in hosted environments:

- `prod` -> `https://tooli.st`
- `test` -> `https://test.tooli.st`
- `dev` -> `http://localhost:3024`

If you do not pass any environment flags, the CLI resolves the target in this
order:

1. `--base-url`
2. `--env`
3. `TOOLLIST_ENV`
4. saved config active environment
5. `prod`

`--base-url` is for self-hosted or custom deployments. Hosted environment
selection always uses the canonical Toollist URLs above, even if you previously
saved a profile for that environment.

Examples:

```bash
npx toolist-cli@latest login --env test
npx toolist-cli@latest whoami --env prod
TOOLIST_ENV=dev npx toolist-cli@latest files upload --input ./photo.jpg
npx toolist-cli@latest tools list --base-url https://self-hosted.example.com --token $TOOLIST_TOKEN
```

After logging in, commands reuse the saved login automatically. You only need
`--token` when you want to override saved credentials explicitly.

## Common Commands

Run a high-level image conversion:

```bash
npx toolist-cli@latest image convert --input ./photo.jpg --to webp --sync --wait
```

Remove a watermark from a single image:

```bash
npx toolist-cli@latest image remove-watermark --input ./photo.jpg --wait --output ./photo-clean.jpg
```

Remove the background from a single image:

```bash
npx toolist-cli@latest image remove-background --input ./photo.png --wait --output ./photo-background-removed.png
```

Resize an image and write the derived artifact locally:

```bash
npx toolist-cli@latest image resize --input ./photo.jpg --width 1200 --to webp --sync --wait --output ./photo-1200.webp
```

Crop an image to a bounding box and download the result:

```bash
npx toolist-cli@latest image crop --input ./photo.jpg --x 120 --y 80 --width 640 --height 480 --to png --sync --wait --output ./photo-crop.png
```

Convert a DOCX file into a Markdown bundle:

```bash
npx toolist-cli@latest document docx-to-markdown --input ./document.docx --wait --output ./bundle.zip
```

Convert multiple DOCX files into Markdown bundles:

```bash
npx toolist-cli@latest document docx-to-markdown-batch --inputs ./chapter-1.docx ./chapter-2.docx --wait --output ./results.zip
```

Run a manifest-driven batch:

```bash
npx toolist-cli@latest batch run --manifest ./batch.json
```

List available hosted tools:

```bash
npx toolist-cli@latest tools list --env test
```

Example manifest:

```json
{
  "version": 1,
  "defaults": {
    "concurrency": 2,
    "wait": true,
    "download_outputs": true,
    "output_dir": "./outputs"
  },
  "items": [
    {
      "id": "resize-1",
      "tool_name": "image.resize",
      "input_path": "./photo.jpg",
      "input": {
        "width": 1200,
        "target_mime_type": "image/webp"
      }
    },
    {
      "id": "crop-1",
      "tool_name": "image.crop",
      "input_path": "./photo.jpg",
      "input": {
        "x": 0,
        "y": 0,
        "width": 640,
        "height": 480,
        "target_mime_type": "image/webp"
      }
    }
  ]
}
```

## Development

```bash
npm install
npm run lint
npm test
npm run build
```

After building, the executable is available at `dist/cli.js`.

## Contributing

Issues and pull requests are welcome. Before opening a release-oriented change,
make sure you run the local checks above and describe any hosted `test`
validation you performed.

Maintainers should also read:

- [Delivery Docs Hub](https://github.com/lintheyoung/toollist-gateway-app/blob/staging/docs/delivery/README.md)
- [One-Page Team Execution Flow](https://github.com/lintheyoung/toollist-gateway-app/blob/staging/docs/delivery/team-execution-one-page.md)
- [Maintainer Guide](./docs/maintainers.md)
- [Release Handbook](./docs/release-handbook.md)

## Release

Releases publish to npm through GitHub Actions after the pre-release gate has
passed. See [docs/release-handbook.md](./docs/release-handbook.md) for the
maintainer checklist.

Released under the MIT License.
