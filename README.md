# Toollist CLI

Toollist CLI is the standalone, agent-first command-line interface for the Toollist platform.

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

## Usage

Authenticate with the platform:

```bash
npx toolist-cli@latest login
```

By default the CLI connects to `https://tooli.st`. Use `--base-url` only when
targeting a self-hosted, staging, or other custom environment.

After logging in, commands reuse the saved login automatically. You only need
`--token` when you want to override the saved credentials explicitly.

Inspect your current identity:

```bash
npx toolist-cli@latest whoami
```

Run a high-level image conversion:

```bash
npx toolist-cli@latest image convert --input ./photo.jpg --to webp --sync --wait
```

Remove a watermark from a single image:

```bash
npx toolist-cli@latest image remove-watermark --input ./photo.jpg --wait --output ./photo-clean.jpg
```

Remove watermarks from a batch of images in a zip:

```bash
npx toolist-cli@latest image remove-watermark-batch --inputs ./a.jpg ./b.jpg --wait --output ./cleaned-images.zip
```

Resize an image and write the derived artifact locally:

```bash
npx toolist-cli@latest image resize --input ./photo.jpg --width 1200 --to webp --sync --wait --output ./photo-1200.webp
```

Crop an image to a bounding box and download the result:

```bash
npx toolist-cli@latest image crop --input ./photo.jpg --x 120 --y 80 --width 640 --height 480 --to png --sync --wait --output ./photo-crop.png
```

Run a manifest-driven batch:

```bash
npx toolist-cli@latest batch run --manifest ./batch.json
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
npm test
npm run build
```

After building, the executable is available at `dist/cli.js`.

## Release

See [docs/release-handbook.md](./docs/release-handbook.md) for the checklist to
push this repo to GitHub and publish it to npm.

Released under the MIT License.
