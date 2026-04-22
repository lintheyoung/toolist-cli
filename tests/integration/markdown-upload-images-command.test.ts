import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('../../src/commands/files/upload.js');
});

async function runCli(args: string[]) {
  let stdout = '';
  let stderr = '';

  const { main } = await import('../../src/cli.js');
  const exitCode = await main(args, {
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });

  return { exitCode, stdout, stderr };
}

function createUploadResult(fileId: string, publicUrl: string) {
  return {
    file_id: fileId,
    upload_url: `https://upload.example.com/${fileId}`,
    public_url: publicUrl,
    headers: {},
    filename: `${fileId}.png`,
    mime_type: 'image/png',
    size_bytes: 12,
    file: {
      fileId,
      status: 'uploaded',
    },
  };
}

describe('markdown upload-images command', () => {
  it('shows --report in markdown help and markdown upload-images help', async () => {
    const markdownHelp = await runCli(['markdown', '--help']);
    const uploadImagesHelp = await runCli(['markdown', 'upload-images', '--help']);

    expect(markdownHelp.exitCode).toBe(0);
    expect(markdownHelp.stderr).toBe('');
    expect(markdownHelp.stdout).toContain('[--report <path>]');

    expect(uploadImagesHelp.exitCode).toBe(0);
    expect(uploadImagesHelp.stderr).toBe('');
    expect(uploadImagesHelp.stdout).toContain('[--report <path>]');
    expect(uploadImagesHelp.stdout).toContain('--report      Write the JSON report to a file');
  });

  it('uploads local markdown images and coverImage, skips remote URLs, reuses duplicates, and rewrites in place', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-markdown-upload-'));
    const imageDir = join(tempDir, 'images');
    const assetDir = join(tempDir, 'assets');
    const markdownPath = join(tempDir, 'article.md');
    const coverPath = join(imageDir, 'cover.png');
    const demoPath = join(imageDir, 'demo.png');
    const stepPath = join(assetDir, 'step-1.webp');

    try {
      await mkdir(imageDir, { recursive: true });
      await mkdir(assetDir, { recursive: true });
      await writeFile(coverPath, 'cover image');
      await writeFile(demoPath, 'demo image');
      await writeFile(stepPath, 'step image');
      await writeFile(markdownPath, [
        '---',
        'title: Demo',
        'coverImage: "./images/cover.png"',
        '---',
        '',
        '![demo](./images/demo.png)',
        '![step 1](assets/step-1.webp "Step 1")',
        '![duplicate](./images/demo.png)',
        '![remote](https://img.tooli.st/public/files/file_existing/a.png)',
        '![data](data:image/png;base64,abc123)',
      ].join('\n'));

      const uploadCommand = vi
        .fn()
        .mockResolvedValueOnce(createUploadResult('file_cover', 'https://img.tooli.st/public/files/file_cover/cover.png'))
        .mockResolvedValueOnce(createUploadResult('file_demo', 'https://img.tooli.st/public/files/file_demo/demo.png'))
        .mockResolvedValueOnce(createUploadResult('file_step', 'https://img.tooli.st/public/files/file_step/step-1.webp'));

      vi.doMock('../../src/commands/files/upload.js', () => ({
        uploadCommand,
      }));

      const result = await runCli([
        'markdown',
        'upload-images',
        '--input',
        markdownPath,
        '--in-place',
        '--public',
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(uploadCommand).toHaveBeenCalledTimes(3);
      expect(uploadCommand).toHaveBeenNthCalledWith(1, {
        input: coverPath,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        configPath: undefined,
        public: true,
      });
      expect(uploadCommand).toHaveBeenNthCalledWith(2, {
        input: demoPath,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        configPath: undefined,
        public: true,
      });
      expect(uploadCommand).toHaveBeenNthCalledWith(3, {
        input: stepPath,
        baseUrl: 'https://api.example.com',
        token: 'tgc_cli_secret',
        configPath: undefined,
        public: true,
      });

      const updatedMarkdown = await readFile(markdownPath, 'utf8');
      expect(updatedMarkdown).toContain('coverImage: "https://img.tooli.st/public/files/file_cover/cover.png"');
      expect(updatedMarkdown).toContain('![demo](https://img.tooli.st/public/files/file_demo/demo.png)');
      expect(updatedMarkdown).toContain('![step 1](https://img.tooli.st/public/files/file_step/step-1.webp "Step 1")');
      expect(updatedMarkdown).toContain('![duplicate](https://img.tooli.st/public/files/file_demo/demo.png)');
      expect(updatedMarkdown).toContain('![remote](https://img.tooli.st/public/files/file_existing/a.png)');
      expect(updatedMarkdown).toContain('![data](data:image/png;base64,abc123)');

      expect(JSON.parse(result.stdout)).toEqual({
        files: [
          {
            path: markdownPath,
            changed: true,
            image_links_found: 3,
            cover_image_found: true,
            uploaded: 3,
            replacements: [
              {
                kind: 'coverImage',
                from: './images/cover.png',
                to: 'https://img.tooli.st/public/files/file_cover/cover.png',
                file_id: 'file_cover',
              },
              {
                kind: 'markdown_image',
                from: './images/demo.png',
                to: 'https://img.tooli.st/public/files/file_demo/demo.png',
                file_id: 'file_demo',
              },
              {
                kind: 'markdown_image',
                from: 'assets/step-1.webp',
                to: 'https://img.tooli.st/public/files/file_step/step-1.webp',
                file_id: 'file_step',
              },
              {
                kind: 'markdown_image',
                from: './images/demo.png',
                to: 'https://img.tooli.st/public/files/file_demo/demo.png',
                file_id: 'file_demo',
              },
            ],
          },
        ],
        total_files: 1,
        total_changed: 1,
        total_uploaded: 3,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('writes the final JSON report to a nested report path matching stdout', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-markdown-upload-report-'));
    const imageDir = join(tempDir, 'images');
    const markdownPath = join(tempDir, 'article.md');
    const imagePath = join(imageDir, 'demo.png');
    const reportPath = join(tempDir, 'reports', 'nested', 'toolist-upload-report.json');

    try {
      await mkdir(imageDir, { recursive: true });
      await writeFile(imagePath, 'demo image');
      await writeFile(markdownPath, '![demo](./images/demo.png)');

      const uploadCommand = vi.fn(async () => createUploadResult(
        'file_demo',
        'https://img.tooli.st/public/files/file_demo/demo.png',
      ));

      vi.doMock('../../src/commands/files/upload.js', () => ({
        uploadCommand,
      }));

      const result = await runCli([
        'markdown',
        'upload-images',
        '--input',
        markdownPath,
        '--in-place',
        '--public',
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
        '--report',
        reportPath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        total_files: 1,
        total_changed: 1,
        total_uploaded: 1,
      });
      await expect(readFile(reportPath, 'utf8')).resolves.toBe(result.stdout);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails without stdout JSON when writing the report file fails', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-markdown-upload-report-fail-'));
    const markdownPath = join(tempDir, 'article.md');
    const reportPath = join(tempDir, 'article.md', 'report.json');

    try {
      await writeFile(markdownPath, 'No local images.');

      const uploadCommand = vi.fn();

      vi.doMock('../../src/commands/files/upload.js', () => ({
        uploadCommand,
      }));

      const result = await runCli([
        'markdown',
        'upload-images',
        '--input',
        markdownPath,
        '--in-place',
        '--public',
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
        '--report',
        reportPath,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/EEXIST|ENOTDIR|file already exists|not a directory/i);
      expect(uploadCommand).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('processes batches with --root and --glob and uses --env test credentials', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-markdown-upload-batch-'));
    const rootDir = join(tempDir, 'split_articles');
    const imagePath = join(rootDir, 'images', 'one.png');
    const firstMarkdownPath = join(rootDir, 'one.md');
    const secondMarkdownPath = join(rootDir, 'two.md');
    const ignoredMarkdownPath = join(rootDir, 'nested', 'ignored.md');

    try {
      await mkdir(join(rootDir, 'images'), { recursive: true });
      await mkdir(join(rootDir, 'nested'), { recursive: true });
      await writeFile(imagePath, 'one image');
      await writeFile(firstMarkdownPath, '![one](images/one.png)');
      await writeFile(secondMarkdownPath, 'No local images here.');
      await writeFile(ignoredMarkdownPath, '![ignored](../images/one.png)');

      const uploadCommand = vi.fn(async () => createUploadResult(
        'file_one',
        'https://img-test.tooli.st/public/files/file_one/one.png',
      ));

      vi.doMock('../../src/commands/files/upload.js', () => ({
        uploadCommand,
      }));

      const result = await runCli([
        'markdown',
        'upload-images',
        '--root',
        rootDir,
        '--glob',
        '*.md',
        '--in-place',
        '--public',
        '--env',
        'test',
        '--token',
        'tgc_cli_secret',
        '--json',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(uploadCommand).toHaveBeenCalledTimes(1);
      expect(uploadCommand).toHaveBeenCalledWith({
        input: imagePath,
        baseUrl: 'https://test.tooli.st',
        token: 'tgc_cli_secret',
        configPath: undefined,
        public: true,
      });
      expect(await readFile(firstMarkdownPath, 'utf8')).toBe(
        '![one](https://img-test.tooli.st/public/files/file_one/one.png)',
      );
      expect(await readFile(secondMarkdownPath, 'utf8')).toBe('No local images here.');
      expect(await readFile(ignoredMarkdownPath, 'utf8')).toBe('![ignored](../images/one.png)');

      const report = JSON.parse(result.stdout);
      expect(report.total_files).toBe(2);
      expect(report.total_changed).toBe(1);
      expect(report.total_uploaded).toBe(1);
      expect(report.files.map((file: { path: string }) => file.path).sort()).toEqual([
        firstMarkdownPath,
        secondMarkdownPath,
      ].sort());
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails before uploading when required safety flags are missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-markdown-upload-required-'));
    const markdownPath = join(tempDir, 'article.md');

    try {
      await writeFile(markdownPath, '![demo](demo.png)');

      const uploadCommand = vi.fn();
      vi.doMock('../../src/commands/files/upload.js', () => ({
        uploadCommand,
      }));

      const missingPublic = await runCli([
        'markdown',
        'upload-images',
        '--input',
        markdownPath,
        '--in-place',
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
      ]);

      const missingInPlace = await runCli([
        'markdown',
        'upload-images',
        '--input',
        markdownPath,
        '--public',
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
      ]);

      expect(missingPublic.exitCode).toBe(1);
      expect(missingPublic.stderr).toContain('Missing required option: --public');
      expect(missingInPlace.exitCode).toBe(1);
      expect(missingInPlace.stderr).toContain('Missing required option: --in-place');
      expect(uploadCommand).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails clearly when a local markdown image is missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-markdown-upload-missing-'));
    const markdownPath = join(tempDir, 'article.md');

    try {
      await writeFile(markdownPath, '![missing](images/missing.png)');

      const uploadCommand = vi.fn();
      vi.doMock('../../src/commands/files/upload.js', () => ({
        uploadCommand,
      }));

      const result = await runCli([
        'markdown',
        'upload-images',
        '--input',
        markdownPath,
        '--in-place',
        '--public',
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Local image not found: images/missing.png');
      expect(uploadCommand).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects conflicting or missing input mode options', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'toollist-markdown-upload-mode-'));
    const markdownPath = join(tempDir, 'article.md');

    try {
      await writeFile(markdownPath, 'No images.');

      const bothModes = await runCli([
        'markdown',
        'upload-images',
        '--input',
        markdownPath,
        '--root',
        tempDir,
        '--in-place',
        '--public',
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
      ]);

      const noMode = await runCli([
        'markdown',
        'upload-images',
        '--in-place',
        '--public',
        '--base-url',
        'https://api.example.com',
        '--token',
        'tgc_cli_secret',
      ]);

      expect(bothModes.exitCode).toBe(1);
      expect(bothModes.stderr).toContain('Pass either --input or --root, not both.');
      expect(noMode.exitCode).toBe(1);
      expect(noMode.stderr).toContain('Missing required option: --input or --root');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
