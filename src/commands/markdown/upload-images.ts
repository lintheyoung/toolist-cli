import { mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { glob } from 'glob';

import { uploadCommand } from '../files/upload.js';

export interface MarkdownUploadImagesCommandArgs {
  input?: string;
  root?: string;
  glob?: string;
  inPlace: boolean;
  outputDir?: string;
  output?: string;
  public: true;
  dryRun?: boolean;
  skipMissing?: boolean;
  baseUrl: string;
  token: string;
  configPath?: string;
}

export interface MarkdownUploadImagesReplacement {
  kind: 'coverImage' | 'markdown_image';
  from: string;
  to: string;
  file_id: string;
}

export interface MarkdownUploadImagesLocalImage {
  kind: 'coverImage' | 'markdown_image';
  from: string;
  path: string;
  exists: boolean;
  would_upload: boolean;
}

export interface MarkdownUploadImagesMissingImage {
  kind: 'coverImage' | 'markdown_image';
  from: string;
  path: string;
}

export interface MarkdownUploadImagesFileReport {
  path: string;
  output_path?: string;
  would_write_path?: string;
  changed: boolean;
  image_links_found: number;
  cover_image_found: boolean;
  uploaded: number;
  replacements: MarkdownUploadImagesReplacement[];
  local_images: MarkdownUploadImagesLocalImage[];
  missing: MarkdownUploadImagesMissingImage[];
}

export interface MarkdownUploadImagesReport {
  dry_run: boolean;
  files: MarkdownUploadImagesFileReport[];
  total_files: number;
  total_changed: number;
  total_uploaded: number;
  total_missing: number;
}

export interface MarkdownUploadImagesDependencies {
  uploadCommand: typeof uploadCommand;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  mkdir: typeof mkdir;
  stat: typeof stat;
  glob: typeof glob;
}

type LocalImageReference = {
  kind: 'coverImage' | 'markdown_image';
  markdownPath: string;
  from: string;
  absolutePath: string;
  start: number;
  end: number;
};

type ScannedMarkdownFile = {
  path: string;
  content: string;
  references: LocalImageReference[];
  imageLinksFound: number;
  coverImageFound: boolean;
};

type UploadedImage = {
  fileId: string;
  publicUrl: string;
};

type LocalImageExistence = {
  reference: LocalImageReference;
  exists: boolean;
};

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;
const DEFAULT_MARKDOWN_GLOB = '*.md';

function createDefaultDependencies(): MarkdownUploadImagesDependencies {
  return {
    uploadCommand,
    readFile,
    writeFile,
    mkdir,
    stat,
    glob,
  };
}

function isRemoteOrDataImage(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('data:image/')
  );
}

function resolveImagePath(markdownPath: string, imagePath: string): string {
  return isAbsolute(imagePath)
    ? imagePath
    : resolve(dirname(markdownPath), imagePath);
}

function parseMarkdownDestination(rawDestination: string): {
  path: string;
  start: number;
  end: number;
} | null {
  const leadingWhitespace = rawDestination.match(/^\s*/)?.[0].length ?? 0;
  const destination = rawDestination.slice(leadingWhitespace);

  if (!destination) {
    return null;
  }

  if (destination.startsWith('<')) {
    const closingIndex = destination.indexOf('>');

    if (closingIndex <= 1) {
      return null;
    }

    return {
      path: destination.slice(1, closingIndex),
      start: leadingWhitespace + 1,
      end: leadingWhitespace + closingIndex,
    };
  }

  const pathMatch = /^(\S+)/.exec(destination);

  if (!pathMatch) {
    return null;
  }

  return {
    path: pathMatch[1]!,
    start: leadingWhitespace,
    end: leadingWhitespace + pathMatch[1]!.length,
  };
}

function findFrontmatterEnd(content: string): number | null {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null;
  }

  const delimiter = /\r?\n---(?:\r?\n|$)/g;
  delimiter.lastIndex = 3;
  const match = delimiter.exec(content);

  if (!match) {
    return null;
  }

  return match.index + match[0].length;
}

function findCoverImageReference(markdownPath: string, content: string): {
  reference?: LocalImageReference;
  found: boolean;
} {
  const frontmatterEnd = findFrontmatterEnd(content);

  if (frontmatterEnd === null) {
    return { found: false };
  }

  const frontmatter = content.slice(0, frontmatterEnd);
  const linePattern = /(.*?)(\r?\n|$)/g;
  let lineMatch: RegExpExecArray | null;

  while ((lineMatch = linePattern.exec(frontmatter)) !== null) {
    const line = lineMatch[1]!;
    const lineStart = lineMatch.index;
    const quoted = /^(\s*coverImage\s*:\s*)(["'])([^"']*)\2(\s*)$/.exec(line);
    const unquoted = /^(\s*coverImage\s*:\s*)(\S+)(\s*)$/.exec(line);
    const match = quoted ?? unquoted;

    if (match) {
      const value = quoted ? quoted[3]! : unquoted![2]!;
      const valuePrefixLength = quoted
        ? match[1]!.length + match[2]!.length
        : match[1]!.length;

      if (isRemoteOrDataImage(value)) {
        return { found: true };
      }

      return {
        found: true,
        reference: {
          kind: 'coverImage',
          markdownPath,
          from: value,
          absolutePath: resolveImagePath(markdownPath, value),
          start: lineStart + valuePrefixLength,
          end: lineStart + valuePrefixLength + value.length,
        },
      };
    }

    if (lineMatch[0] === '') {
      break;
    }
  }

  return { found: false };
}

function findMarkdownImageReferences(markdownPath: string, content: string): {
  references: LocalImageReference[];
  imageLinksFound: number;
} {
  const references: LocalImageReference[] = [];
  const frontmatterEnd = findFrontmatterEnd(content) ?? 0;
  let imageLinksFound = 0;
  let match: RegExpExecArray | null;

  MARKDOWN_IMAGE_PATTERN.lastIndex = 0;

  while ((match = MARKDOWN_IMAGE_PATTERN.exec(content)) !== null) {
    if (match.index < frontmatterEnd) {
      continue;
    }

    const rawDestination = match[1]!;
    const destination = parseMarkdownDestination(rawDestination);

    if (!destination || isRemoteOrDataImage(destination.path)) {
      continue;
    }

    const destinationStart = match.index + match[0].indexOf(rawDestination);

    references.push({
      kind: 'markdown_image',
      markdownPath,
      from: destination.path,
      absolutePath: resolveImagePath(markdownPath, destination.path),
      start: destinationStart + destination.start,
      end: destinationStart + destination.end,
    });
    imageLinksFound += 1;
  }

  return { references, imageLinksFound };
}

async function assertFile(path: string, description: string, deps: Pick<MarkdownUploadImagesDependencies, 'stat'>): Promise<void> {
  try {
    const fileStats = await deps.stat(path);

    if (!fileStats.isFile()) {
      throw new Error(`${description} is not a file: ${path}`);
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${description} not found: ${path}`);
    }

    throw error;
  }
}

async function assertDirectory(path: string, deps: Pick<MarkdownUploadImagesDependencies, 'stat'>): Promise<void> {
  try {
    const directoryStats = await deps.stat(path);

    if (!directoryStats.isDirectory()) {
      throw new Error(`Markdown root is not a directory: ${path}`);
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Markdown root not found: ${path}`);
    }

    throw error;
  }
}

async function listMarkdownFiles(
  args: Pick<MarkdownUploadImagesCommandArgs, 'input' | 'root' | 'glob'>,
  deps: Pick<MarkdownUploadImagesDependencies, 'glob' | 'stat'>,
): Promise<string[]> {
  if (args.input) {
    const inputPath = resolve(args.input);
    await assertFile(inputPath, 'Markdown file', deps);
    return [inputPath];
  }

  const rootPath = resolve(args.root!);
  await assertDirectory(rootPath, deps);
  const matches = await deps.glob(args.glob ?? DEFAULT_MARKDOWN_GLOB, {
    cwd: rootPath,
    absolute: true,
    nodir: true,
  });

  return matches.map((match) => resolve(match)).sort();
}

async function scanMarkdownFile(
  markdownPath: string,
  deps: Pick<MarkdownUploadImagesDependencies, 'readFile'>,
): Promise<ScannedMarkdownFile> {
  const content = await deps.readFile(markdownPath, 'utf8');
  const coverImage = findCoverImageReference(markdownPath, content);
  const markdownImages = findMarkdownImageReferences(markdownPath, content);

  return {
    path: markdownPath,
    content,
    references: [
      ...(coverImage.reference ? [coverImage.reference] : []),
      ...markdownImages.references,
    ],
    imageLinksFound: markdownImages.imageLinksFound,
    coverImageFound: coverImage.found,
  };
}

async function collectLocalImageExistence(
  scannedFiles: ScannedMarkdownFile[],
  deps: Pick<MarkdownUploadImagesDependencies, 'stat'>,
): Promise<Map<LocalImageReference, boolean>> {
  const checkedPaths = new Map<string, boolean>();
  const results = new Map<LocalImageReference, boolean>();

  for (const scannedFile of scannedFiles) {
    for (const reference of scannedFile.references) {
      const cached = checkedPaths.get(reference.absolutePath);

      if (cached !== undefined) {
        results.set(reference, cached);
        continue;
      }

      try {
        const fileStats = await deps.stat(reference.absolutePath);

        if (!fileStats.isFile()) {
          throw new Error(`Local image is not a file: ${reference.from} (referenced by ${scannedFile.path})`);
        }

        checkedPaths.set(reference.absolutePath, true);
        results.set(reference, true);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          checkedPaths.set(reference.absolutePath, false);
          results.set(reference, false);
          continue;
        }

        throw error;
      }
    }
  }

  return results;
}

function createLocalImageExistence(scannedFile: ScannedMarkdownFile, existence: Map<LocalImageReference, boolean>): LocalImageExistence[] {
  return scannedFile.references.map((reference) => ({
    reference,
    exists: existence.get(reference) ?? false,
  }));
}

function createLocalImageReport(localImages: LocalImageExistence[]): MarkdownUploadImagesLocalImage[] {
  return localImages.map(({ reference, exists }) => ({
    kind: reference.kind,
    from: reference.from,
    path: reference.absolutePath,
    exists,
    would_upload: exists,
  }));
}

function createMissingImageReport(localImages: LocalImageExistence[]): MarkdownUploadImagesMissingImage[] {
  return localImages
    .filter(({ exists }) => !exists)
    .map(({ reference }) => ({
      kind: reference.kind,
      from: reference.from,
      path: reference.absolutePath,
    }));
}

function throwIfMissingImages(scannedFiles: ScannedMarkdownFile[], existence: Map<LocalImageReference, boolean>): void {
  for (const scannedFile of scannedFiles) {
    for (const reference of scannedFile.references) {
      if (!existence.get(reference)) {
        throw new Error(`Local image not found: ${reference.from} (referenced by ${scannedFile.path})`);
      }
    }
  }
}

function validateWriteTarget(args: Pick<MarkdownUploadImagesCommandArgs, 'input' | 'root' | 'inPlace' | 'outputDir' | 'output'>): void {
  if (args.inPlace && args.outputDir) {
    throw new Error('Pass either --in-place or --output-dir, not both.');
  }

  if (args.inPlace && args.output) {
    throw new Error('Pass either --in-place or --output, not both.');
  }

  if (args.output && args.outputDir) {
    throw new Error('Pass either --output or --output-dir, not both.');
  }

  if (args.output && !args.input) {
    throw new Error('--output is only supported with --input.');
  }

  if (args.outputDir && !args.root) {
    throw new Error('--output-dir is only supported with --root.');
  }

  if (!args.inPlace && !args.output && !args.outputDir) {
    throw new Error('Missing write target: pass --in-place, --output, or --output-dir');
  }
}

function resolveMarkdownOutputPath(scannedFile: ScannedMarkdownFile, args: MarkdownUploadImagesCommandArgs): string {
  if (args.inPlace) {
    return scannedFile.path;
  }

  if (args.output) {
    return resolve(args.output);
  }

  const rootPath = resolve(args.root!);
  const outputDir = resolve(args.outputDir!);
  return resolve(outputDir, relative(rootPath, scannedFile.path));
}

function assertOutputDoesNotOverwriteSource(outputPath: string, sourcePath: string): void {
  if (resolve(outputPath) === resolve(sourcePath)) {
    throw new Error(`Output path matches source Markdown. Use --in-place to overwrite source: ${sourcePath}`);
  }
}

async function uploadImage(
  reference: LocalImageReference,
  args: Pick<MarkdownUploadImagesCommandArgs, 'baseUrl' | 'token' | 'configPath'>,
  deps: Pick<MarkdownUploadImagesDependencies, 'uploadCommand'>,
  cache: Map<string, UploadedImage>,
): Promise<{ image: UploadedImage; uploaded: boolean }> {
  const cached = cache.get(reference.absolutePath);

  if (cached) {
    return { image: cached, uploaded: false };
  }

  const result = await deps.uploadCommand({
    input: reference.absolutePath,
    baseUrl: args.baseUrl,
    token: args.token,
    configPath: args.configPath,
    public: true,
  });

  if (!result.public_url) {
    throw new Error(`Upload did not return a public URL for ${reference.from}.`);
  }

  const uploadedImage = {
    fileId: result.file_id,
    publicUrl: result.public_url,
  };
  cache.set(reference.absolutePath, uploadedImage);

  return { image: uploadedImage, uploaded: true };
}

function applyReplacements(content: string, replacements: Array<{ start: number; end: number; to: string }>): string {
  let updatedContent = content;

  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    updatedContent = `${updatedContent.slice(0, replacement.start)}${replacement.to}${updatedContent.slice(replacement.end)}`;
  }

  return updatedContent;
}

export async function markdownUploadImagesCommand(
  args: MarkdownUploadImagesCommandArgs,
  dependencies: Partial<MarkdownUploadImagesDependencies> = {},
): Promise<MarkdownUploadImagesReport> {
  if (args.input && args.root) {
    throw new Error('Pass either --input or --root, not both.');
  }

  if (!args.input && !args.root) {
    throw new Error('Missing required option: --input or --root');
  }

  validateWriteTarget(args);

  if (!args.public) {
    throw new Error('Missing required option: --public');
  }

  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const markdownFiles = await listMarkdownFiles(args, deps);
  const scannedFiles = await Promise.all(markdownFiles.map((markdownPath) => scanMarkdownFile(markdownPath, deps)));
  const outputPaths = new Map<ScannedMarkdownFile, string>();

  for (const scannedFile of scannedFiles) {
    const outputPath = resolveMarkdownOutputPath(scannedFile, args);

    if (!args.inPlace) {
      assertOutputDoesNotOverwriteSource(outputPath, scannedFile.path);
    }

    outputPaths.set(scannedFile, outputPath);
  }

  const imageExistence = await collectLocalImageExistence(scannedFiles, deps);

  if (!args.dryRun && !args.skipMissing) {
    throwIfMissingImages(scannedFiles, imageExistence);
  }

  if (args.dryRun) {
    const reports = scannedFiles.map((scannedFile) => {
      const localImages = createLocalImageExistence(scannedFile, imageExistence);
      const missing = createMissingImageReport(localImages);
      const writePath = outputPaths.get(scannedFile)!;

      return {
        path: scannedFile.path,
        ...(!args.inPlace ? { would_write_path: writePath } : {}),
        changed: false,
        image_links_found: scannedFile.imageLinksFound,
        cover_image_found: scannedFile.coverImageFound,
        uploaded: 0,
        replacements: [],
        local_images: createLocalImageReport(localImages),
        missing,
      };
    });

    return {
      dry_run: true,
      files: reports,
      total_files: reports.length,
      total_changed: 0,
      total_uploaded: 0,
      total_missing: reports.reduce((total, file) => total + file.missing.length, 0),
    };
  }

  const uploadCache = new Map<string, UploadedImage>();
  const reports: MarkdownUploadImagesFileReport[] = [];
  let totalUploaded = 0;

  for (const scannedFile of scannedFiles) {
    const localImages = createLocalImageExistence(scannedFile, imageExistence);
    const missing = createMissingImageReport(localImages);
    const textReplacements: Array<{ start: number; end: number; to: string }> = [];
    const reportReplacements: MarkdownUploadImagesReplacement[] = [];
    let uploaded = 0;

    for (const { reference, exists } of localImages) {
      if (!exists) {
        continue;
      }

      const { image, uploaded: didUpload } = await uploadImage(reference, args, deps, uploadCache);

      if (didUpload) {
        uploaded += 1;
        totalUploaded += 1;
      }

      textReplacements.push({
        start: reference.start,
        end: reference.end,
        to: image.publicUrl,
      });
      reportReplacements.push({
        kind: reference.kind,
        from: reference.from,
        to: image.publicUrl,
        file_id: image.fileId,
      });
    }

    const updatedContent = applyReplacements(scannedFile.content, textReplacements);
    const changed = updatedContent !== scannedFile.content;
    const outputPath = outputPaths.get(scannedFile)!;

    if (changed || !args.inPlace) {
      await deps.mkdir(dirname(outputPath), { recursive: true });
      await deps.writeFile(outputPath, updatedContent);
    }

    reports.push({
      path: scannedFile.path,
      ...(!args.inPlace ? { output_path: outputPath } : {}),
      changed,
      image_links_found: scannedFile.imageLinksFound,
      cover_image_found: scannedFile.coverImageFound,
      uploaded,
      replacements: reportReplacements,
      local_images: createLocalImageReport(localImages),
      missing,
    });
  }

  return {
    dry_run: false,
    files: reports,
    total_files: reports.length,
    total_changed: reports.filter((file) => file.changed).length,
    total_uploaded: totalUploaded,
    total_missing: reports.reduce((total, file) => total + file.missing.length, 0),
  };
}
