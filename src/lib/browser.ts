import { spawn } from 'node:child_process';
import { platform } from 'node:os';

function getBrowserCommand(): { command: string; args: string[]; windowsHide?: boolean } {
  const currentPlatform = platform();

  if (currentPlatform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', 'start', '""'],
      windowsHide: true,
    };
  }

  if (currentPlatform === 'darwin') {
    return {
      command: 'open',
      args: [],
    };
  }

  return {
    command: 'xdg-open',
    args: [],
  };
}

export async function openBrowser(url: string): Promise<void> {
  const { command, args, windowsHide } = getBrowserCommand();
  const isWindows = command === 'cmd';
  const launchArgs = isWindows ? [...args, `"${url}"`] : [...args, url];
  const child = spawn(command, launchArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide,
    windowsVerbatimArguments: isWindows,
  });

  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
}
