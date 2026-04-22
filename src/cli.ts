#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { documentDocxToMarkdownBatchCommand } from './commands/document/docx-to-markdown-batch.js';
import { documentDocxToMarkdownCommand } from './commands/document/docx-to-markdown.js';
import { imageConvertBatchCommand } from './commands/image/convert-batch.js';
import { imageConvertCommand } from './commands/image/convert.js';
import { imageCropBatchCommand } from './commands/image/crop-batch.js';
import { imageCropCommand } from './commands/image/crop.js';
import { imageRemoveBackgroundCommand } from './commands/image/remove-background.js';
import { imageRemoveWatermarkCommand } from './commands/image/remove-watermark.js';
import { imageRemoveWatermarkBatchCommand } from './commands/image/remove-watermark-batch.js';
import { imageResizeBatchCommand } from './commands/image/resize-batch.js';
import { imageResizeCommand } from './commands/image/resize.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { markdownUploadImagesCommand } from './commands/markdown/upload-images.js';
import { runBatchCommand } from './commands/batch/run.js';
import { uploadCommand } from './commands/files/upload.js';
import { getJobCommand } from './commands/jobs/get.js';
import { waitJobCommand } from './commands/jobs/wait.js';
import { listToolsCommand } from './commands/tools/list.js';
import { whoamiCommand } from './commands/whoami.js';
import { readBatchManifest } from './lib/batch-manifest.js';
import { getProfileForEnvironment, loadConfig } from './lib/config.js';
import { createStderrProgressReporter } from './lib/progress-reporter.js';
import {
  DEFAULT_ENVIRONMENT,
  resolveEnvironmentBaseUrl,
  resolveEnvironmentName,
  resolveEnvironmentSelection,
  resolveSelectedProfileBaseUrl,
  type ToolistEnvironment,
} from './lib/environments.js';

export interface CliIO {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

const defaultIO: CliIO = {
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (chunk) => process.stderr.write(chunk),
};

export const DEFAULT_BASE_URL = resolveEnvironmentBaseUrl(DEFAULT_ENVIRONMENT);
const ENVIRONMENT_OPTION_HELP = '  --env          Target environment: prod | test | dev';

function unknownOption(flag: string): never {
  throw new Error(`Unknown option: ${flag}`);
}

function unexpectedPositional(arg: string): never {
  throw new Error(`Unexpected positional argument: ${arg}`);
}

function missingOptionValue(flag: string): never {
  throw new Error(`Missing value for option: ${flag}`);
}

async function writeReportFile(path: string, contents: string): Promise<void> {
  const resolvedPath = resolve(path);

  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, contents, 'utf8');
}

function parseOption(arg: string, args: string[], index: number): {
  flag: string;
  value?: string;
  rawValue?: string;
  consumeNext: boolean;
} {
  const [flag, inlineValue] = arg.startsWith('--') ? arg.split('=', 2) : [arg, undefined];
  const nextArg = inlineValue === undefined ? args[index + 1] : undefined;
  const consumeNext = inlineValue === undefined && nextArg !== undefined && !nextArg.startsWith('-');
  const rawValue = inlineValue ?? (consumeNext ? nextArg : undefined);
  const value = rawValue && !rawValue.startsWith('-') ? rawValue : undefined;

  return {
    flag,
    value,
    rawValue,
    consumeNext,
  };
}

function isExplicitEmptyOption(rawValue: string | undefined): boolean {
  return rawValue === '';
}

function isIntegerInRange(value: number, minimum: number, maximum?: number): boolean {
  if (!Number.isInteger(value) || value < minimum) {
    return false;
  }

  if (maximum !== undefined && value > maximum) {
    return false;
  }

  return true;
}

export function getRootHelp(): string {
  return [
    'toollist - agent-first CLI for the Toollist platform',
    '',
    `Default API base URL: ${DEFAULT_BASE_URL}`,
    'Use --env for hosted Toollist targets. Use --base-url only for self-hosted or custom environments.',
    '',
    'Usage:',
    '  toollist <command> [options]',
    '',
    'Commands:',
    '  login    Sign in with Toollist',
    '  logout   Clear local credentials',
    '  whoami   Show the current identity',
    '  tools    Low-level tool registry commands',
    '  files    Low-level file commands',
    '  markdown Markdown content commands',
    '  document High-level document commands',
    '  image    High-level image commands',
    '  jobs     Low-level job commands',
    '  batch    Manifest-driven batch commands',
    '  help     Show help for a command',
    '',
    'Discover supported tools:',
    '  toollist tools list',
    '  toollist image remove-background --input photo.png --wait --output photo-background-removed.png',
    '',
    'Options:',
    '  -h, --help  Show help',
    ENVIRONMENT_OPTION_HELP,
    '  --json      Emit JSON output explicitly (default behavior)',
  ].join('\n') + '\n';
}

export function getToolsHelp(): string {
  return [
    'toollist tools',
    '',
    'Usage:',
    '  toollist tools list',
    '',
    'Commands:',
    '  list    List available tools',
  ].join('\n') + '\n';
}

export function getFilesHelp(): string {
  return [
    'toollist files',
    '',
    'Usage:',
    '  toollist files upload --input <path> [--sha256] [--public] [--env <prod|test|dev>]',
    '',
    `Defaults to ${DEFAULT_BASE_URL}.`,
    '',
    'Commands:',
    '  upload  Upload a file through the API',
    '',
    'Options:',
    '  --sha256  Compute and send a client-side sha256 during upload completion',
    '  --public  Request a public upload URL and public file access',
  ].join('\n') + '\n';
}

export function getMarkdownHelp(): string {
  return [
    'toollist markdown',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist markdown upload-images (--input <path> (--in-place | --output <path>) | --root <dir> [--glob <pattern>] (--in-place | --output-dir <dir>)) --public [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json] [--report <path>] [--dry-run] [--skip-missing]',
    '',
    'Commands:',
    '  upload-images  Upload local Markdown images and rewrite them to public URLs',
  ].join('\n') + '\n';
}

export function getMarkdownUploadImagesHelp(): string {
  return [
    'toollist markdown upload-images',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist markdown upload-images --input <path> (--in-place | --output <path>) --public [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json] [--report <path>] [--dry-run] [--skip-missing]',
    '  toollist markdown upload-images --root <dir> [--glob <pattern>] (--in-place | --output-dir <dir>) --public [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json] [--report <path>] [--dry-run] [--skip-missing]',
    '',
    'Options:',
    '  --input        Markdown file path for single-file mode',
    '  --root         Root directory for batch mode',
    '  --glob         Glob pattern used with --root (defaults to *.md)',
    '  --in-place     Write updated Markdown back to the source file',
    '  --output       Write single-file output Markdown to this path',
    '  --output-dir   Write batch output Markdown under this directory',
    '  --public       Required safety flag for public image uploads',
    `  --base-url     API base URL (defaults to ${DEFAULT_BASE_URL})`,
    ENVIRONMENT_OPTION_HELP,
    '  --token        API access token',
    '  --config-path  Path to saved CLI config',
    '  --json         Emit JSON output explicitly (default behavior)',
    '  --report      Write the JSON report to a file',
    '  --dry-run     Scan and report local images without uploading or writing Markdown',
    '  --skip-missing Continue when local images are missing and report them',
  ].join('\n') + '\n';
}

export function getDocumentHelp(): string {
  return [
    'toollist document',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist document docx-to-markdown --input <path> [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist document docx-to-markdown-batch --inputs <path...> [--input-glob <pattern>] [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Commands:',
    '  docx-to-markdown        Convert a DOCX file into a Markdown bundle through the API',
    '  docx-to-markdown-batch  Convert zipped DOCX inputs into Markdown bundles through the API',
  ].join('\n') + '\n';
}

export function getDocumentDocxToMarkdownHelp(): string {
  return [
    'toollist document docx-to-markdown',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist document docx-to-markdown --input <path> [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Options:',
    '  --input        DOCX file path',
    '  --wait         Wait for the conversion job to finish',
    '  --timeout      Maximum wait time in seconds',
    '  --output       Download bundle.zip to a local path',
    `  --base-url     API base URL (defaults to ${DEFAULT_BASE_URL})`,
    ENVIRONMENT_OPTION_HELP,
    '  --token        API access token',
    '  --config-path  Path to saved CLI config',
    '  --json         Emit JSON output explicitly (default behavior)',
  ].join('\n') + '\n';
}

export function getDocumentDocxToMarkdownBatchHelp(): string {
  return [
    'toollist document docx-to-markdown-batch',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist document docx-to-markdown-batch --inputs <path...> [--input-glob <pattern>] [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Options:',
    '  --inputs       One or more DOCX input file paths',
    '  --input-glob   Glob pattern for DOCX input files',
    '  --wait         Wait for the batch conversion job to finish',
    '  --timeout      Maximum wait time in seconds',
    '  --output       Download results.zip to a local path',
    `  --base-url     API base URL (defaults to ${DEFAULT_BASE_URL})`,
    ENVIRONMENT_OPTION_HELP,
    '  --token        API access token',
    '  --config-path  Path to saved CLI config',
    '  --json         Emit JSON output explicitly (default behavior)',
  ].join('\n') + '\n';
}

export function getImageHelp(): string {
  return [
    'toollist image',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist image convert --input <path> --to <format> [--quality <1-100>] [--sync] [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist image convert-batch --inputs <path...> [--input-glob <pattern>] --to <format> [--quality <1-100>] [--concurrency <n>] [--wait] [--output-dir <path>] [--resume] [--base-url <url>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist image remove-background --input <path> [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist image remove-watermark --input <path> [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist image remove-watermark-batch --inputs <path...> [--input-glob <pattern>] [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist image resize --input <path> [--width <pixels>] [--height <pixels>] [--to <format>] [--quality <1-100>] [--sync] [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist image resize-batch --inputs <path...> [--input-glob <pattern>] [--width <pixels>] [--height <pixels>] [--to <format>] [--concurrency <n>] [--wait] [--output-dir <path>] [--resume] [--base-url <url>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist image crop-batch --inputs <path...> [--input-glob <pattern>] --x <pixels> --y <pixels> --width <pixels> --height <pixels> [--to <format>] [--quality <1-100>] [--concurrency <n>] [--wait] [--output-dir <path>] [--resume] [--base-url <url>] [--token <token>] [--config-path <path>] [--json]',
    '  toollist image crop --input <path> --x <pixels> --y <pixels> --width <pixels> --height <pixels> [--to <format>] [--quality <1-100>] [--sync] [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Commands:',
    '  convert  Convert an image format through the API',
    '  convert-batch  Convert multiple images through the batch wrapper',
    '  remove-background  Remove the background from an image through the API',
    '  remove-watermark  Remove a watermark from an image through the API',
    '  remove-watermark-batch  Remove watermarks from a zipped image batch through the API',
    '  resize   Resize an image through the API',
    '  resize-batch  Resize multiple images through the batch wrapper',
    '  crop-batch  Crop multiple images through the batch wrapper',
    '  crop     Crop an image through the API',
  ].join('\n') + '\n';
}

export function getImageRemoveBackgroundHelp(): string {
  return [
    'toollist image remove-background',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist image remove-background --input <path> [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Options:',
    '  --input        Image file path',
    '  --wait         Wait for the background removal job to finish',
    '  --timeout      Maximum wait time in seconds',
    '  --output       Download background-removed PNG to a local path',
    `  --base-url     API base URL (defaults to ${DEFAULT_BASE_URL})`,
    ENVIRONMENT_OPTION_HELP,
    '  --token        API access token',
    '  --config-path  Path to saved CLI config',
    '  --json         Emit JSON output explicitly (default behavior)',
  ].join('\n') + '\n';
}

export function getImageConvertBatchHelp(): string {
  return [
    'toollist image convert-batch',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist image convert-batch --inputs <path...> [--input-glob <pattern>] --to <format> [--quality <1-100>] [--concurrency <n>] [--wait] [--output-dir <path>] [--resume] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Options:',
    '  --inputs       One or more input file paths',
    '  --input-glob   Glob pattern for input files',
    '  --to           Target output format',
    '  --quality      Output quality as an integer from 1 to 100',
    '  --concurrency  Number of batch items to run in parallel',
    '  --wait         Wait for each batch job to finish',
    '  --output-dir   Directory for downloaded outputs',
    '  --resume       Resume a previous batch run if possible',
    `  --base-url     API base URL (defaults to ${DEFAULT_BASE_URL})`,
    ENVIRONMENT_OPTION_HELP,
    '  --token        API access token',
    '  --config-path  Path to saved CLI config',
    '  --json         Emit JSON output explicitly (default behavior)',
  ].join('\n') + '\n';
}

export function getImageResizeBatchHelp(): string {
  return [
    'toollist image resize-batch',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist image resize-batch --inputs <path...> [--input-glob <pattern>] [--width <pixels>] [--height <pixels>] [--to <format>] [--concurrency <n>] [--wait] [--output-dir <path>] [--resume] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Options:',
    '  --inputs       One or more input file paths',
    '  --input-glob   Glob pattern for input files',
    '  --width        Resize width in pixels',
    '  --height       Resize height in pixels',
    '  --to           Target output format',
    '  --concurrency  Number of batch items to run in parallel',
    '  --wait         Wait for each batch job to finish',
    '  --output-dir   Directory for downloaded outputs',
    '  --resume       Resume a previous batch run if possible',
    `  --base-url     API base URL (defaults to ${DEFAULT_BASE_URL})`,
    ENVIRONMENT_OPTION_HELP,
    '  --token        API access token',
    '  --config-path  Path to saved CLI config',
    '  --json         Emit JSON output explicitly (default behavior)',
  ].join('\n') + '\n';
}

export function getImageRemoveWatermarkBatchHelp(): string {
  return [
    'toollist image remove-watermark-batch',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist image remove-watermark-batch --inputs <path...> [--input-glob <pattern>] [--wait] [--timeout <seconds>] [--output <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Options:',
    '  --inputs       One or more input file paths',
    '  --input-glob   Glob pattern for input files',
    '  --wait         Wait for the batch job to finish',
    '  --timeout      Maximum wait time in seconds',
    '  --output       Download results.zip to a local path',
    `  --base-url     API base URL (defaults to ${DEFAULT_BASE_URL})`,
    ENVIRONMENT_OPTION_HELP,
    '  --token        API access token',
    '  --config-path  Path to saved CLI config',
    '  --json         Emit JSON output explicitly (default behavior)',
  ].join('\n') + '\n';
}

export function getImageCropBatchHelp(): string {
  return [
    'toollist image crop-batch',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist image crop-batch --inputs <path...> [--input-glob <pattern>] --x <pixels> --y <pixels> --width <pixels> --height <pixels> [--to <format>] [--quality <1-100>] [--concurrency <n>] [--wait] [--output-dir <path>] [--resume] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Options:',
    '  --inputs       One or more input file paths',
    '  --input-glob   Glob pattern for input files',
    '  --x            Crop offset from the left in pixels',
    '  --y            Crop offset from the top in pixels',
    '  --width        Crop width in pixels',
    '  --height       Crop height in pixels',
    '  --to           Target output format',
    '  --quality      Output quality as an integer from 1 to 100',
    '  --concurrency  Number of batch items to run in parallel',
    '  --wait         Wait for each batch job to finish',
    '  --output-dir   Directory for downloaded outputs',
    '  --resume       Resume a previous batch run if possible',
    `  --base-url     API base URL (defaults to ${DEFAULT_BASE_URL})`,
    ENVIRONMENT_OPTION_HELP,
    '  --token        API access token',
    '  --config-path  Path to saved CLI config',
    '  --json         Emit JSON output explicitly (default behavior)',
  ].join('\n') + '\n';
}

export function getJobsHelp(): string {
  return [
    'toollist jobs',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist jobs get <jobId> [--env <prod|test|dev>]',
    '  toollist jobs wait <jobId> --timeout 120 [--env <prod|test|dev>]',
    '',
    'Commands:',
    '  get     Fetch a job by id',
    '  wait    Poll a job until terminal',
  ].join('\n') + '\n';
}

export function getBatchHelp(): string {
  return [
    'toollist batch',
    '',
    `Defaults to ${DEFAULT_BASE_URL}. Use --base-url only for non-production targets.`,
    '',
    'Usage:',
    '  toollist batch run --manifest <path> [--resume] [--concurrency <n>] [--output-dir <path>] [--base-url <url>] [--env <prod|test|dev>] [--token <token>] [--config-path <path>] [--json]',
    '',
    'Commands:',
    '  run     Run a manifest-driven batch',
  ].join('\n') + '\n';
}

function parseLoginArgs(args: string[]): {
  baseUrl?: string;
  env?: ToolistEnvironment;
  clientName?: string;
  configPath?: string;
} {
  const parsed: {
    baseUrl?: string;
    env?: ToolistEnvironment;
    clientName?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--client-name') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.clientName = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseConfigPathArgs(args: string[]): {
  env?: ToolistEnvironment;
  configPath?: string;
} {
  const parsed: {
    env?: ToolistEnvironment;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, consumeNext } = parseOption(arg, args, index);

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

type SharedApiArgs = {
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
};

function parseApiArgs(args: string[], strict = false): SharedApiArgs {
  const parsed: SharedApiArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (strict && flag.startsWith('-')) {
      unknownOption(flag);
    }

    if (strict) {
      unexpectedPositional(arg);
    }
  }

  return parsed;
}

function parseUploadArgs(args: string[]): {
  input?: string;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
  computeSha256?: boolean;
  public?: boolean;
} {
  const parsed: {
    input?: string;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
    computeSha256?: boolean;
    public?: boolean;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--input') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.input = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--sha256') {
      parsed.computeSha256 = true;
      continue;
    }

    if (flag === '--public') {
      parsed.public = true;
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseMarkdownUploadImagesArgs(args: string[]): {
  input?: string;
  root?: string;
  glob?: string;
  inPlace?: boolean;
  outputDir?: string;
  output?: string;
  public?: boolean;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
  reportPath?: string;
  dryRun?: boolean;
  skipMissing?: boolean;
} {
  const parsed: {
    input?: string;
    root?: string;
    glob?: string;
    inPlace?: boolean;
    outputDir?: string;
    output?: string;
    public?: boolean;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
    reportPath?: string;
    dryRun?: boolean;
    skipMissing?: boolean;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--report') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.reportPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--input') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.input = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--root') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.root = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--glob') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.glob = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output-dir') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.outputDir = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.output = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--in-place') {
      parsed.inPlace = true;
      continue;
    }

    if (flag === '--public') {
      parsed.public = true;
      continue;
    }

    if (flag === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (flag === '--skip-missing') {
      parsed.skipMissing = true;
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseImageConvertArgs(args: string[]): {
  input?: string;
  to?: string;
  quality?: number;
  sync?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    input?: string;
    to?: string;
    quality?: number;
    sync?: boolean;
    wait?: boolean;
    timeoutSeconds?: number;
    output?: string;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {
    ...parseApiArgs(args),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--input' && value) {
      parsed.input = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--to' && value) {
      parsed.to = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--quality') {
      const qualityValue = Number(value ?? rawValue);

      if (!Number.isFinite(qualityValue)) {
        throw new Error('Invalid value for --quality.');
      }

      parsed.quality = qualityValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--sync') {
      parsed.sync = true;
      continue;
    }

    if (flag === '--timeout') {
      const timeoutValue = Number(value ?? rawValue);

      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('Invalid value for --timeout.');
      }

      parsed.timeoutSeconds = timeoutValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output' && value) {
      parsed.output = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseImageRemoveWatermarkArgs(args: string[]): {
  input?: string;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    input?: string;
    wait?: boolean;
    timeoutSeconds?: number;
    output?: string;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {
    ...parseApiArgs(args),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--input' && value) {
      parsed.input = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--timeout') {
      const timeoutValue = Number(value ?? rawValue);

      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('Invalid value for --timeout.');
      }

      parsed.timeoutSeconds = timeoutValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output' && value) {
      parsed.output = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseImageRemoveWatermarkBatchArgs(args: string[]): {
  inputs?: string[];
  inputGlob?: string;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    inputs?: string[];
    inputGlob?: string;
    wait?: boolean;
    timeoutSeconds?: number;
    output?: string;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {
    ...parseApiArgs(args),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--inputs') {
      if (!value) {
        missingOptionValue(flag);
      }

      const inputs: string[] = [value];

      if (consumeNext) {
        index += 1;
      }

      while (index + 1 < args.length && args[index + 1] && !args[index + 1]!.startsWith('-')) {
        index += 1;
        inputs.push(args[index]!);
      }

      parsed.inputs = [...(parsed.inputs ?? []), ...inputs];
      continue;
    }

    if (flag === '--input-glob') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.inputGlob = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--timeout') {
      const timeoutValue = Number(value ?? rawValue);

      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('Invalid value for --timeout.');
      }

      parsed.timeoutSeconds = timeoutValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output' && value) {
      parsed.output = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

const parseDocumentDocxToMarkdownArgs = parseImageRemoveWatermarkArgs;
const parseDocumentDocxToMarkdownBatchArgs = parseImageRemoveWatermarkBatchArgs;
const parseImageRemoveBackgroundArgs = parseImageRemoveWatermarkArgs;

function parseImageResizeArgs(args: string[]): {
  input?: string;
  width?: number;
  height?: number;
  to?: string;
  quality?: number;
  sync?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    input?: string;
    width?: number;
    height?: number;
    to?: string;
    quality?: number;
    sync?: boolean;
    wait?: boolean;
    timeoutSeconds?: number;
    output?: string;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {
    ...parseApiArgs(args),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--input' && value) {
      parsed.input = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--width') {
      const widthValue = Number(value ?? rawValue);

      if (!isIntegerInRange(widthValue, 1)) {
        throw new Error('Invalid value for --width.');
      }

      parsed.width = widthValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--height') {
      const heightValue = Number(value ?? rawValue);

      if (!isIntegerInRange(heightValue, 1)) {
        throw new Error('Invalid value for --height.');
      }

      parsed.height = heightValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--to' && value) {
      parsed.to = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--quality') {
      const qualityValue = Number(value ?? rawValue);

      if (!isIntegerInRange(qualityValue, 1, 100)) {
        throw new Error('Invalid value for --quality.');
      }

      parsed.quality = qualityValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--sync') {
      parsed.sync = true;
      continue;
    }

    if (flag === '--timeout') {
      const timeoutValue = Number(value ?? rawValue);

      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('Invalid value for --timeout.');
      }

      parsed.timeoutSeconds = timeoutValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output' && value) {
      parsed.output = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseImageResizeBatchArgs(args: string[]): {
  inputs?: string[];
  inputGlob?: string;
  width?: number;
  height?: number;
  to?: string;
  concurrency?: number;
  wait?: boolean;
  outputDir?: string;
  resume?: boolean;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    inputs?: string[];
    inputGlob?: string;
    width?: number;
    height?: number;
    to?: string;
    concurrency?: number;
    wait?: boolean;
    outputDir?: string;
    resume?: boolean;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--inputs') {
      if (!value) {
        missingOptionValue(flag);
      }

      const inputs: string[] = [value];

      if (consumeNext) {
        index += 1;
      }

      while (index + 1 < args.length && args[index + 1] && !args[index + 1]!.startsWith('-')) {
        index += 1;
        inputs.push(args[index]!);
      }

      parsed.inputs = [...(parsed.inputs ?? []), ...inputs];
      continue;
    }

    if (flag === '--input-glob') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.inputGlob = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--width') {
      const widthValue = Number(value ?? rawValue);

      if (!isIntegerInRange(widthValue, 1)) {
        throw new Error('Invalid value for --width.');
      }

      parsed.width = widthValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--height') {
      const heightValue = Number(value ?? rawValue);

      if (!isIntegerInRange(heightValue, 1)) {
        throw new Error('Invalid value for --height.');
      }

      parsed.height = heightValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--to' && value) {
      parsed.to = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--concurrency') {
      const concurrencyValue = Number(value ?? rawValue);

      if (!isIntegerInRange(concurrencyValue, 1)) {
        throw new Error('Invalid value for --concurrency.');
      }

      parsed.concurrency = concurrencyValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--output-dir') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.outputDir = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--resume') {
      parsed.resume = true;
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseImageConvertBatchArgs(args: string[]): {
  inputs?: string[];
  inputGlob?: string;
  to?: string;
  quality?: number;
  concurrency?: number;
  wait?: boolean;
  outputDir?: string;
  resume?: boolean;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    inputs?: string[];
    inputGlob?: string;
    to?: string;
    quality?: number;
    concurrency?: number;
    wait?: boolean;
    outputDir?: string;
    resume?: boolean;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--inputs') {
      if (!value) {
        missingOptionValue(flag);
      }

      const inputs: string[] = [value];

      if (consumeNext) {
        index += 1;
      }

      while (index + 1 < args.length && args[index + 1] && !args[index + 1]!.startsWith('-')) {
        index += 1;
        inputs.push(args[index]!);
      }

      parsed.inputs = [...(parsed.inputs ?? []), ...inputs];
      continue;
    }

    if (flag === '--input-glob') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.inputGlob = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--to' && value) {
      parsed.to = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--quality') {
      const qualityValue = Number(value ?? rawValue);

      if (!isIntegerInRange(qualityValue, 1, 100)) {
        throw new Error('Invalid value for --quality.');
      }

      parsed.quality = qualityValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--concurrency') {
      const concurrencyValue = Number(value ?? rawValue);

      if (!isIntegerInRange(concurrencyValue, 1)) {
        throw new Error('Invalid value for --concurrency.');
      }

      parsed.concurrency = concurrencyValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--output-dir') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.outputDir = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--resume') {
      parsed.resume = true;
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseImageCropBatchArgs(args: string[]): {
  inputs?: string[];
  inputGlob?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  to?: string;
  quality?: number;
  concurrency?: number;
  wait?: boolean;
  outputDir?: string;
  resume?: boolean;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    inputs?: string[];
    inputGlob?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    to?: string;
    quality?: number;
    concurrency?: number;
    wait?: boolean;
    outputDir?: string;
    resume?: boolean;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--inputs') {
      if (!value) {
        missingOptionValue(flag);
      }

      const inputs: string[] = [value];

      if (consumeNext) {
        index += 1;
      }

      while (index + 1 < args.length && args[index + 1] && !args[index + 1]!.startsWith('-')) {
        index += 1;
        inputs.push(args[index]!);
      }

      parsed.inputs = [...(parsed.inputs ?? []), ...inputs];
      continue;
    }

    if (flag === '--input-glob') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.inputGlob = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--x') {
      const xValue = Number(value ?? rawValue);

      if (!isIntegerInRange(xValue, 0)) {
        throw new Error('Invalid value for --x.');
      }

      parsed.x = xValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--y') {
      const yValue = Number(value ?? rawValue);

      if (!isIntegerInRange(yValue, 0)) {
        throw new Error('Invalid value for --y.');
      }

      parsed.y = yValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--width') {
      const widthValue = Number(value ?? rawValue);

      if (!isIntegerInRange(widthValue, 1)) {
        throw new Error('Invalid value for --width.');
      }

      parsed.width = widthValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--height') {
      const heightValue = Number(value ?? rawValue);

      if (!isIntegerInRange(heightValue, 1)) {
        throw new Error('Invalid value for --height.');
      }

      parsed.height = heightValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--to' && value) {
      parsed.to = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--quality') {
      const qualityValue = Number(value ?? rawValue);

      if (!isIntegerInRange(qualityValue, 1, 100)) {
        throw new Error('Invalid value for --quality.');
      }

      parsed.quality = qualityValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--concurrency') {
      const concurrencyValue = Number(value ?? rawValue);

      if (!isIntegerInRange(concurrencyValue, 1)) {
        throw new Error('Invalid value for --concurrency.');
      }

      parsed.concurrency = concurrencyValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--output-dir') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.outputDir = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--resume') {
      parsed.resume = true;
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseImageCropArgs(args: string[]): {
  input?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  to?: string;
  quality?: number;
  sync?: boolean;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    input?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    to?: string;
    quality?: number;
    sync?: boolean;
    wait?: boolean;
    timeoutSeconds?: number;
    output?: string;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {
    ...parseApiArgs(args),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--input' && value) {
      parsed.input = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--x') {
      const xValue = Number(value ?? rawValue);

      if (!isIntegerInRange(xValue, 0)) {
        throw new Error('Invalid value for --x.');
      }

      parsed.x = xValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--y') {
      const yValue = Number(value ?? rawValue);

      if (!isIntegerInRange(yValue, 0)) {
        throw new Error('Invalid value for --y.');
      }

      parsed.y = yValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--width') {
      const widthValue = Number(value ?? rawValue);

      if (!isIntegerInRange(widthValue, 1)) {
        throw new Error('Invalid value for --width.');
      }

      parsed.width = widthValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--height') {
      const heightValue = Number(value ?? rawValue);

      if (!isIntegerInRange(heightValue, 1)) {
        throw new Error('Invalid value for --height.');
      }

      parsed.height = heightValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--to' && value) {
      parsed.to = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--quality') {
      const qualityValue = Number(value ?? rawValue);

      if (!isIntegerInRange(qualityValue, 1, 100)) {
        throw new Error('Invalid value for --quality.');
      }

      parsed.quality = qualityValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--sync') {
      parsed.sync = true;
      continue;
    }

    if (flag === '--timeout') {
      const timeoutValue = Number(value ?? rawValue);

      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('Invalid value for --timeout.');
      }

      parsed.timeoutSeconds = timeoutValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output' && value) {
      parsed.output = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseJobArgs(args: string[]): {
  jobId?: string;
  timeoutSeconds?: number;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    jobId?: string;
    timeoutSeconds?: number;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--timeout') {
      const timeoutValue = Number(value ?? rawValue);

      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('Invalid value for --timeout.');
      }

      parsed.timeoutSeconds = timeoutValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (!flag.startsWith('-') && !parsed.jobId) {
      parsed.jobId = flag;
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

function parseBatchRunArgs(args: string[]): {
  manifestPath?: string;
  resume?: boolean;
  concurrency?: number;
  outputDir?: string;
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    manifestPath?: string;
    resume?: boolean;
    concurrency?: number;
    outputDir?: string;
    baseUrl?: string;
    env?: ToolistEnvironment;
    token?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const { flag, value, rawValue, consumeNext } = parseOption(arg, args, index);

    if (flag === '--manifest') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.manifestPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--resume') {
      parsed.resume = true;
      continue;
    }

    if (flag === '--concurrency') {
      const concurrencyValue = Number(value ?? rawValue);

      if (!isIntegerInRange(concurrencyValue, 1)) {
        throw new Error('Invalid value for --concurrency.');
      }

      parsed.concurrency = concurrencyValue;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output-dir') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.outputDir = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--env') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.env = resolveEnvironmentName(value);
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value && !isExplicitEmptyOption(rawValue)) {
        missingOptionValue(flag);
      }
      if (value) {
        parsed.token = value;
      }
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (consumeNext) {
        index += 1;
      }
      continue;
    }

    if (flag === '--json') {
      continue;
    }

    if (flag.startsWith('-')) {
      unknownOption(flag);
    }

    unexpectedPositional(arg);
  }

  return parsed;
}

async function resolveApiCredentials(args: {
  baseUrl?: string;
  env?: ToolistEnvironment;
  token?: string;
  configPath?: string;
}): Promise<{
  baseUrl: string;
  token: string;
}> {
  const config = await loadConfig(args.configPath);
  const selection = resolveEnvironmentSelection({
    requestedEnvironment: args.env,
    configuredEnvironment: config?.activeEnvironment,
    environmentVariable: process.env.TOOLIST_ENV,
  });
  const environment = selection.environment;
  const profile = getProfileForEnvironment(config, environment);

  if (!profile?.accessToken && !args.token) {
    throw new Error('Missing authentication. Pass --token or use a saved login.');
  }

  return {
    baseUrl: args.baseUrl ?? resolveSelectedProfileBaseUrl({
      environment,
      profileBaseUrl: profile?.baseUrl,
      isExplicitHostedSelection: selection.isExplicitHostedSelection,
    }),
    token: args.token ?? profile!.accessToken!,
  };
}

export async function main(argv: string[] = process.argv.slice(2), io: CliIO = defaultIO): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    io.stdout(getRootHelp());
    return 0;
  }

  if (command === 'login') {
    try {
      const loginArgs = parseLoginArgs(rest);
      let inferredEnvironment: ToolistEnvironment | undefined;

      if (!loginArgs.baseUrl) {
        const config = await loadConfig(loginArgs.configPath);
        const selection = resolveEnvironmentSelection({
          requestedEnvironment: loginArgs.env,
          configuredEnvironment: config?.activeEnvironment,
          environmentVariable: process.env.TOOLIST_ENV,
        });
        inferredEnvironment = selection.environment;
      }
      const loginBaseUrl = loginArgs.baseUrl
        ?? resolveEnvironmentBaseUrl(inferredEnvironment ?? DEFAULT_ENVIRONMENT);

      const result = await loginCommand({
        baseUrl: loginBaseUrl,
        environment: inferredEnvironment,
        clientName: loginArgs.clientName,
        configPath: loginArgs.configPath,
      }, {
        announceBrowserLaunch: (url) => {
          io.stderr('Opening browser for Toolist login...\n');
          io.stderr(`If the browser does not open, visit this URL manually:\n${url}\n`);
        },
      });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : 'Login failed.'}\n`);
      return 1;
    }
  }

  if (command === 'whoami') {
    try {
      const whoamiArgs = parseConfigPathArgs(rest);
      const result = await whoamiCommand({
        configPath: whoamiArgs.configPath,
        env: whoamiArgs.env,
      });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : 'Whoami failed.'}\n`);
      return 1;
    }
  }

  if (command === 'logout') {
    try {
      const logoutArgs = parseConfigPathArgs(rest);
      const result = await logoutCommand({
        configPath: logoutArgs.configPath,
        env: logoutArgs.env,
      });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : 'Logout failed.'}\n`);
      return 1;
    }
  }

  if (command === 'batch') {
    const [subcommand, ...commandArgs] = rest;

    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
      io.stdout(getBatchHelp());
      return 0;
    }

    if (subcommand === 'run') {
      try {
        const parsed = parseBatchRunArgs(commandArgs);

        if (!parsed.manifestPath) {
          io.stderr('Missing required option: --manifest\n');
          return 1;
        }

        if (!parsed.baseUrl && !parsed.env) {
          const manifest = await readBatchManifest(parsed.manifestPath);
          if (manifest.defaults?.base_url) {
            parsed.baseUrl = manifest.defaults.base_url;
          }
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await runBatchCommand({
          manifestPath: parsed.manifestPath,
          resume: parsed.resume ?? false,
          concurrency: parsed.concurrency,
          outputDir: parsed.outputDir,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Batch run failed.'}\n`);
        return 1;
      }
    }
  }

  if (command === 'tools') {
    const [subcommand, ...commandArgs] = rest;

    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
      io.stdout(getToolsHelp());
      return 0;
    }

    if (subcommand === 'list') {
      try {
        const parsed = parseApiArgs(commandArgs, true);
        const credentials = await resolveApiCredentials(parsed);
        const result = await listToolsCommand({
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Tools list failed.'}\n`);
        return 1;
      }
    }
  }

  if (command === 'files') {
    const [subcommand, ...commandArgs] = rest;

    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
      io.stdout(getFilesHelp());
      return 0;
    }

    if (subcommand === 'upload') {
      try {
        const parsed = parseUploadArgs(commandArgs);

        if (!parsed.input) {
          io.stderr('Missing required option: --input\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await uploadCommand({
          input: parsed.input,
          ...credentials,
          configPath: parsed.configPath,
          computeSha256: parsed.computeSha256 ?? false,
          ...(parsed.public ? { public: true } : {}),
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Files upload failed.'}\n`);
        return 1;
      }
    }
  }

  if (command === 'markdown') {
    const [subcommand, ...commandArgs] = rest;

    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
      io.stdout(getMarkdownHelp());
      return 0;
    }

    if (subcommand === 'upload-images' && (commandArgs[0] === '--help' || commandArgs[0] === '-h' || commandArgs[0] === 'help')) {
      io.stdout(getMarkdownUploadImagesHelp());
      return 0;
    }

    if (subcommand === 'upload-images') {
      try {
        const parsed = parseMarkdownUploadImagesArgs(commandArgs);

        if (parsed.input && parsed.root) {
          io.stderr('Pass either --input or --root, not both.\n');
          return 1;
        }

        if (!parsed.input && !parsed.root) {
          io.stderr('Missing required option: --input or --root\n');
          return 1;
        }

        if (parsed.inPlace && parsed.outputDir) {
          io.stderr('Pass either --in-place or --output-dir, not both.\n');
          return 1;
        }

        if (parsed.inPlace && parsed.output) {
          io.stderr('Pass either --in-place or --output, not both.\n');
          return 1;
        }

        if (parsed.output && parsed.outputDir) {
          io.stderr('Pass either --output or --output-dir, not both.\n');
          return 1;
        }

        if (parsed.output && !parsed.input) {
          io.stderr('--output is only supported with --input.\n');
          return 1;
        }

        if (parsed.outputDir && !parsed.root) {
          io.stderr('--output-dir is only supported with --root.\n');
          return 1;
        }

        if (!parsed.inPlace && !parsed.output && !parsed.outputDir) {
          io.stderr('Missing write target: pass --in-place, --output, or --output-dir\n');
          return 1;
        }

        if (!parsed.public) {
          io.stderr('Missing required option: --public\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await markdownUploadImagesCommand({
          input: parsed.input,
          root: parsed.root,
          glob: parsed.glob,
          inPlace: parsed.inPlace ?? false,
          outputDir: parsed.outputDir,
          output: parsed.output,
          public: true,
          dryRun: parsed.dryRun,
          skipMissing: parsed.skipMissing,
          ...credentials,
          configPath: parsed.configPath,
        });
        const jsonOutput = `${JSON.stringify(result)}\n`;

        if (parsed.reportPath) {
          // Keep failed report writes from looking successful to stdout consumers.
          await writeReportFile(parsed.reportPath, jsonOutput);
        }

        io.stdout(jsonOutput);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Markdown upload-images failed.'}\n`);
        return 1;
      }
    }
  }

  if (command === 'document') {
    const [subcommand, ...commandArgs] = rest;

    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
      io.stdout(getDocumentHelp());
      return 0;
    }

    if (subcommand === 'docx-to-markdown' && (commandArgs[0] === '--help' || commandArgs[0] === '-h' || commandArgs[0] === 'help')) {
      io.stdout(getDocumentDocxToMarkdownHelp());
      return 0;
    }

    if (subcommand === 'docx-to-markdown-batch' && (commandArgs[0] === '--help' || commandArgs[0] === '-h' || commandArgs[0] === 'help')) {
      io.stdout(getDocumentDocxToMarkdownBatchHelp());
      return 0;
    }

    if (subcommand === 'docx-to-markdown') {
      try {
        const parsed = parseDocumentDocxToMarkdownArgs(commandArgs);

        if (!parsed.input) {
          io.stderr('Missing required option: --input\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await documentDocxToMarkdownCommand({
          input: parsed.input,
          wait: parsed.wait,
          timeoutSeconds: parsed.timeoutSeconds,
          output: parsed.output,
          ...credentials,
          configPath: parsed.configPath,
        }, {
          progress: createStderrProgressReporter(io.stderr),
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Document docx-to-markdown failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'docx-to-markdown-batch') {
      try {
        const parsed = parseDocumentDocxToMarkdownBatchArgs(commandArgs);

        if ((!parsed.inputs || parsed.inputs.length === 0) && !parsed.inputGlob) {
          io.stderr('Missing required option: --inputs or --input-glob\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await documentDocxToMarkdownBatchCommand({
          inputs: parsed.inputs,
          inputGlob: parsed.inputGlob,
          wait: parsed.wait,
          timeoutSeconds: parsed.timeoutSeconds,
          output: parsed.output,
          ...credentials,
          configPath: parsed.configPath,
        }, {
          progress: createStderrProgressReporter(io.stderr),
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Document docx-to-markdown-batch failed.'}\n`);
        return 1;
      }
    }
  }

  if (command === 'image') {
    const [subcommand, ...commandArgs] = rest;

    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
      io.stdout(getImageHelp());
      return 0;
    }

    if (subcommand === 'resize-batch' && (commandArgs[0] === '--help' || commandArgs[0] === '-h' || commandArgs[0] === 'help')) {
      io.stdout(getImageResizeBatchHelp());
      return 0;
    }

    if (subcommand === 'crop-batch' && (commandArgs[0] === '--help' || commandArgs[0] === '-h' || commandArgs[0] === 'help')) {
      io.stdout(getImageCropBatchHelp());
      return 0;
    }

    if (subcommand === 'convert-batch' && (commandArgs[0] === '--help' || commandArgs[0] === '-h' || commandArgs[0] === 'help')) {
      io.stdout(getImageConvertBatchHelp());
      return 0;
    }

    if (subcommand === 'remove-watermark-batch' && (commandArgs[0] === '--help' || commandArgs[0] === '-h' || commandArgs[0] === 'help')) {
      io.stdout(getImageRemoveWatermarkBatchHelp());
      return 0;
    }

    if (subcommand === 'remove-background' && (commandArgs[0] === '--help' || commandArgs[0] === '-h' || commandArgs[0] === 'help')) {
      io.stdout(getImageRemoveBackgroundHelp());
      return 0;
    }

    if (subcommand === 'convert') {
      try {
        const parsed = parseImageConvertArgs(commandArgs);

        if (!parsed.input) {
          io.stderr('Missing required option: --input\n');
          return 1;
        }

        if (!parsed.to) {
          io.stderr('Missing required option: --to\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageConvertCommand({
          input: parsed.input,
          to: parsed.to,
          quality: parsed.quality,
          sync: parsed.sync,
          wait: parsed.wait,
          timeoutSeconds: parsed.timeoutSeconds,
          output: parsed.output,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image convert failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'remove-watermark') {
      try {
        const parsed = parseImageRemoveWatermarkArgs(commandArgs);

        if (!parsed.input) {
          io.stderr('Missing required option: --input\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageRemoveWatermarkCommand({
          input: parsed.input,
          wait: parsed.wait,
          timeoutSeconds: parsed.timeoutSeconds,
          output: parsed.output,
          ...credentials,
          configPath: parsed.configPath,
        }, {
          progress: createStderrProgressReporter(io.stderr),
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image remove-watermark failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'remove-background') {
      try {
        const parsed = parseImageRemoveBackgroundArgs(commandArgs);

        if (!parsed.input) {
          io.stderr('Missing required option: --input\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageRemoveBackgroundCommand({
          input: parsed.input,
          wait: parsed.wait,
          timeoutSeconds: parsed.timeoutSeconds,
          output: parsed.output,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image remove-background failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'remove-watermark-batch') {
      try {
        const parsed = parseImageRemoveWatermarkBatchArgs(commandArgs);

        if ((!parsed.inputs || parsed.inputs.length === 0) && !parsed.inputGlob) {
          io.stderr('Missing required option: --inputs or --input-glob\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageRemoveWatermarkBatchCommand({
          inputs: parsed.inputs,
          inputGlob: parsed.inputGlob,
          wait: parsed.wait,
          timeoutSeconds: parsed.timeoutSeconds,
          output: parsed.output,
          env: parsed.env,
          ...credentials,
          configPath: parsed.configPath,
        }, {
          progress: createStderrProgressReporter(io.stderr),
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image remove-watermark-batch failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'convert-batch') {
      try {
        const parsed = parseImageConvertBatchArgs(commandArgs);

        if (!parsed.to) {
          io.stderr('Missing required option: --to\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageConvertBatchCommand({
          inputs: parsed.inputs,
          inputGlob: parsed.inputGlob,
          to: parsed.to,
          quality: parsed.quality,
          concurrency: parsed.concurrency,
          wait: parsed.wait,
          outputDir: parsed.outputDir,
          resume: parsed.resume,
          env: parsed.env,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image convert-batch failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'crop-batch') {
      try {
        const parsed = parseImageCropBatchArgs(commandArgs);

        if (!parsed.x && parsed.x !== 0) {
          io.stderr('Missing required option: --x\n');
          return 1;
        }

        if (parsed.y === undefined) {
          io.stderr('Missing required option: --y\n');
          return 1;
        }

        if (parsed.width === undefined) {
          io.stderr('Missing required option: --width\n');
          return 1;
        }

        if (parsed.height === undefined) {
          io.stderr('Missing required option: --height\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageCropBatchCommand({
          inputs: parsed.inputs,
          inputGlob: parsed.inputGlob,
          x: parsed.x,
          y: parsed.y,
          width: parsed.width,
          height: parsed.height,
          to: parsed.to,
          quality: parsed.quality,
          concurrency: parsed.concurrency,
          wait: parsed.wait,
          outputDir: parsed.outputDir,
          resume: parsed.resume,
          env: parsed.env,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image crop-batch failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'resize') {
      try {
        const parsed = parseImageResizeArgs(commandArgs);

        if (!parsed.input) {
          io.stderr('Missing required option: --input\n');
          return 1;
        }

        if (parsed.width === undefined && parsed.height === undefined) {
          io.stderr('Missing required option: --width or --height\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageResizeCommand({
          input: parsed.input,
          width: parsed.width,
          height: parsed.height,
          to: parsed.to,
          quality: parsed.quality,
          sync: parsed.sync,
          wait: parsed.wait,
          timeoutSeconds: parsed.timeoutSeconds,
          output: parsed.output,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image resize failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'resize-batch') {
      try {
        const parsed = parseImageResizeBatchArgs(commandArgs);

        if (parsed.width === undefined && parsed.height === undefined) {
          io.stderr('Missing required option: --width or --height\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageResizeBatchCommand({
          ...parsed,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image resize-batch failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'crop') {
      try {
        const parsed = parseImageCropArgs(commandArgs);

        if (!parsed.input) {
          io.stderr('Missing required option: --input\n');
          return 1;
        }

        if (parsed.x === undefined) {
          io.stderr('Missing required option: --x\n');
          return 1;
        }

        if (parsed.y === undefined) {
          io.stderr('Missing required option: --y\n');
          return 1;
        }

        if (parsed.width === undefined) {
          io.stderr('Missing required option: --width\n');
          return 1;
        }

        if (parsed.height === undefined) {
          io.stderr('Missing required option: --height\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await imageCropCommand({
          input: parsed.input,
          x: parsed.x,
          y: parsed.y,
          width: parsed.width,
          height: parsed.height,
          to: parsed.to,
          quality: parsed.quality,
          sync: parsed.sync,
          wait: parsed.wait,
          timeoutSeconds: parsed.timeoutSeconds,
          output: parsed.output,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Image crop failed.'}\n`);
        return 1;
      }
    }
  }

  if (command === 'jobs') {
    const [subcommand, ...commandArgs] = rest;

    if (!subcommand || subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
      io.stdout(getJobsHelp());
      return 0;
    }

    if (subcommand === 'get') {
      try {
        const parsed = parseJobArgs(commandArgs);

        if (!parsed.jobId) {
          io.stderr('Missing required argument: jobId\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await getJobCommand({
          jobId: parsed.jobId,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Jobs get failed.'}\n`);
        return 1;
      }
    }

    if (subcommand === 'wait') {
      try {
        const parsed = parseJobArgs(commandArgs);

        if (!parsed.jobId) {
          io.stderr('Missing required argument: jobId\n');
          return 1;
        }

        const credentials = await resolveApiCredentials(parsed);
        const result = await waitJobCommand({
          jobId: parsed.jobId,
          timeoutSeconds: parsed.timeoutSeconds ?? 60,
          ...credentials,
          configPath: parsed.configPath,
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Jobs wait failed.'}\n`);
        return 1;
      }
    }
  }

  io.stderr(`Unknown command: ${command}\n\n`);
  io.stderr(getRootHelp());
  return 1;
}

export function isDirectExecution(
  argvEntry = process.argv[1],
  moduleEntry = fileURLToPath(import.meta.url)
): boolean {
  if (!argvEntry) {
    return false;
  }

  try {
    return realpathSync(resolve(argvEntry)) === realpathSync(moduleEntry);
  } catch {
    return resolve(argvEntry) === resolve(moduleEntry);
  }
}

if (isDirectExecution()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
