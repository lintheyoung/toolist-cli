#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { imageConvertCommand } from './commands/image/convert.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { uploadCommand } from './commands/files/upload.js';
import { getJobCommand } from './commands/jobs/get.js';
import { waitJobCommand } from './commands/jobs/wait.js';
import { listToolsCommand } from './commands/tools/list.js';
import { whoamiCommand } from './commands/whoami.js';
import { loadConfig } from './lib/config.js';

export interface CliIO {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

const defaultIO: CliIO = {
  stdout: (chunk) => process.stdout.write(chunk),
  stderr: (chunk) => process.stderr.write(chunk),
};

function unknownOption(flag: string): never {
  throw new Error(`Unknown option: ${flag}`);
}

function unexpectedPositional(arg: string): never {
  throw new Error(`Unexpected positional argument: ${arg}`);
}

function missingOptionValue(flag: string): never {
  throw new Error(`Missing value for option: ${flag}`);
}

export function getRootHelp(): string {
  return [
    'toollist - agent-first CLI for the Toollist platform',
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
    '  image    High-level image commands',
    '  jobs     Low-level job commands',
    '  help     Show help for a command',
    '',
    'Options:',
    '  -h, --help  Show help',
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
    '  toollist files upload --input <path>',
    '',
    'Commands:',
    '  upload  Upload a file through the API',
  ].join('\n') + '\n';
}

export function getImageHelp(): string {
  return [
    'toollist image',
    '',
    'Usage:',
    '  toollist image convert --input <path> --to <format> [--quality <1-100>] [--wait] [--timeout <seconds>] [--output <path>]',
    '',
    'Commands:',
    '  convert  Convert an image format through the API',
  ].join('\n') + '\n';
}

export function getJobsHelp(): string {
  return [
    'toollist jobs',
    '',
    'Usage:',
    '  toollist jobs get <jobId>',
    '  toollist jobs wait <jobId> --timeout 120',
    '',
    'Commands:',
    '  get     Fetch a job by id',
    '  wait    Poll a job until terminal',
  ].join('\n') + '\n';
}

function parseLoginArgs(args: string[]): {
  baseUrl?: string;
  clientName?: string;
  configPath?: string;
} {
  const parsed: {
    baseUrl?: string;
    clientName?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const [flag, inlineValue] = arg.startsWith('--') ? arg.split('=', 2) : [arg, undefined];
    const nextValue = inlineValue ?? args[index + 1];
    const value = nextValue && !nextValue.startsWith('-') ? nextValue : undefined;

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--client-name') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.clientName = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (!inlineValue) {
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
  configPath?: string;
} {
  const parsed: {
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const [flag, inlineValue] = arg.startsWith('--') ? arg.split('=', 2) : [arg, undefined];
    const nextValue = inlineValue ?? args[index + 1];
    const value = nextValue && !nextValue.startsWith('-') ? nextValue : undefined;

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (!inlineValue) {
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

function parseApiArgs(args: string[], strict = false): {
  baseUrl?: string;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    baseUrl?: string;
    token?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const [flag, inlineValue] = arg.startsWith('--') ? arg.split('=', 2) : [arg, undefined];
    const nextValue = inlineValue ?? args[index + 1];
    const value = nextValue && !nextValue.startsWith('-') ? nextValue : undefined;

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.token = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (!inlineValue) {
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
  token?: string;
  configPath?: string;
} {
  const parsed: {
    input?: string;
    baseUrl?: string;
    token?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const [flag, inlineValue] = arg.startsWith('--') ? arg.split('=', 2) : [arg, undefined];
    const nextValue = inlineValue ?? args[index + 1];
    const value = nextValue && !nextValue.startsWith('-') ? nextValue : undefined;

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.token = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--input') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.input = value;
      if (!inlineValue) {
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

function parseImageConvertArgs(args: string[]): {
  input?: string;
  to?: string;
  quality?: number;
  wait?: boolean;
  timeoutSeconds?: number;
  output?: string;
  baseUrl?: string;
  token?: string;
  configPath?: string;
} {
  const parsed: {
    input?: string;
    to?: string;
    quality?: number;
    wait?: boolean;
    timeoutSeconds?: number;
    output?: string;
    baseUrl?: string;
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

    const [flag, inlineValue] = arg.startsWith('--') ? arg.split('=', 2) : [arg, undefined];
    const nextValue = inlineValue ?? args[index + 1];
    const value = nextValue && !nextValue.startsWith('-') ? nextValue : undefined;

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.token = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--input' && value) {
      parsed.input = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--to' && value) {
      parsed.to = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--quality') {
      const qualityValue = Number(value ?? nextValue);

      if (!Number.isFinite(qualityValue)) {
        throw new Error('Invalid value for --quality.');
      }

      parsed.quality = qualityValue;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--wait') {
      parsed.wait = true;
      continue;
    }

    if (flag === '--timeout') {
      const timeoutValue = Number(value ?? nextValue);

      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('Invalid value for --timeout.');
      }

      parsed.timeoutSeconds = timeoutValue;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--output' && value) {
      parsed.output = value;
      if (!inlineValue) {
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
  token?: string;
  configPath?: string;
} {
  const parsed: {
    jobId?: string;
    timeoutSeconds?: number;
    baseUrl?: string;
    token?: string;
    configPath?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    const [flag, inlineValue] = arg.startsWith('--') ? arg.split('=', 2) : [arg, undefined];
    const nextValue = inlineValue ?? args[index + 1];
    const value = nextValue && !nextValue.startsWith('-') ? nextValue : undefined;

    if (flag === '--base-url') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.baseUrl = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--token') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.token = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--config-path') {
      if (!value) {
        missingOptionValue(flag);
      }
      parsed.configPath = value;
      if (!inlineValue) {
        index += 1;
      }
      continue;
    }

    if (flag === '--timeout') {
      const timeoutValue = Number(value ?? nextValue);

      if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error('Invalid value for --timeout.');
      }

      parsed.timeoutSeconds = timeoutValue;
      if (!inlineValue) {
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

async function resolveApiCredentials(args: {
  baseUrl?: string;
  token?: string;
  configPath?: string;
}): Promise<{
  baseUrl: string;
  token: string;
}> {
  if (args.baseUrl && args.token) {
    return {
      baseUrl: args.baseUrl,
      token: args.token,
    };
  }

  const config = await loadConfig(args.configPath);

  if (!config?.baseUrl && !args.baseUrl) {
    throw new Error('Missing required option: --base-url or saved config.');
  }

  if (!config?.accessToken && !args.token) {
    throw new Error('Missing required option: --token or saved login.');
  }

  return {
    baseUrl: args.baseUrl ?? config!.baseUrl,
    token: args.token ?? config!.accessToken!,
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

      if (!loginArgs.baseUrl) {
        io.stderr('Missing required option: --base-url\n');
        return 1;
      }

      const result = await loginCommand({
        baseUrl: loginArgs.baseUrl,
        clientName: loginArgs.clientName,
        configPath: loginArgs.configPath,
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
      });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : 'Logout failed.'}\n`);
      return 1;
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
        });
        io.stdout(`${JSON.stringify(result)}\n`);
        return 0;
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : 'Files upload failed.'}\n`);
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

const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
