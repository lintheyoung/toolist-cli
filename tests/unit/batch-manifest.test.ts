import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { parseBatchManifest, readBatchManifest } from '../../src/lib/batch-manifest.js';

describe('batch manifest parsing', () => {
  it('parses a valid v1 manifest with defaults and items', () => {
    const manifest = parseBatchManifest(`{
      "version": 1,
      "defaults": {
        "base_url": "https://example.com",
        "concurrency": 4,
        "wait": true,
        "download_outputs": false,
        "output_dir": "./outputs"
      },
      "items": [
        {
          "id": "resize-1",
          "tool_name": "image.resize",
          "input_path": "./photo.jpg",
          "input": {
            "width": 1200
          }
        },
        {
          "id": "crop-1",
          "tool_name": "image.crop",
          "input_file_id": "file_123",
          "input": {
            "x": 0,
            "y": 0,
            "width": 400,
            "height": 300
          }
        }
      ]
    }`);

    expect(manifest.version).toBe(1);
    expect(manifest.defaults).toEqual({
      base_url: 'https://example.com',
      concurrency: 4,
      wait: true,
      download_outputs: false,
      output_dir: './outputs',
    });
    expect(manifest.items).toHaveLength(2);
    expect(manifest.items[0]).toMatchObject({
      id: 'resize-1',
      tool_name: 'image.resize',
      input_path: './photo.jpg',
      input: {
        width: 1200,
      },
    });
    expect(manifest.items[1]).toMatchObject({
      id: 'crop-1',
      tool_name: 'image.crop',
      input_file_id: 'file_123',
      input: {
        x: 0,
        y: 0,
        width: 400,
        height: 300,
      },
    });
  });

  it('rejects manifests without items', () => {
    expect(() =>
      parseBatchManifest(`{
        "version": 1
      }`),
    ).toThrow(/items/i);
  });

  it('rejects items without id or tool_name', () => {
    expect(() =>
      parseBatchManifest(`{
        "version": 1,
        "items": [
          {
            "tool_name": "image.resize",
            "input": {
              "width": 1200
            }
          }
        ]
      }`),
    ).toThrow(/id/i);

    expect(() =>
      parseBatchManifest(`{
        "version": 1,
        "items": [
          {
            "id": "missing-tool",
            "input": {
              "width": 1200
            }
          }
        ]
      }`),
    ).toThrow(/tool_name/i);
  });

  it('rejects items that define neither input_path nor input_file_id', () => {
    expect(() =>
      parseBatchManifest(`{
        "version": 1,
        "items": [
          {
            "id": "missing-input-source",
            "tool_name": "image.resize",
            "input": {
              "width": 1200
            }
          }
        ]
      }`),
    ).toThrow(/input_path|input_file_id/i);
  });

  it('reads a batch manifest from disk', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-batch-manifest-'));
    const manifestPath = join(tempDir, 'batch.json');
    const text = `{
      "version": 1,
      "items": [
        {
          "id": "convert-1",
          "tool_name": "image.convert_format",
          "input_file_id": "file_abc",
          "input": {
            "target_mime_type": "image/webp"
          }
        }
      ]
    }`;

    await writeFile(manifestPath, text, 'utf8');

    const manifest = await readBatchManifest(manifestPath);

    expect(manifest.items).toHaveLength(1);
    expect(manifest.items[0]).toMatchObject({
      id: 'convert-1',
      tool_name: 'image.convert_format',
      input_file_id: 'file_abc',
      input: {
        target_mime_type: 'image/webp',
      },
    });

    await rm(tempDir, { recursive: true, force: true });
  });
});
