import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface CallbackResult {
  code: string;
  state: string;
}

export interface CallbackServer {
  redirectUri: string;
  waitForCallback: () => Promise<CallbackResult>;
  close: () => Promise<void>;
}

function sendText(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(body);
}

function buildRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://127.0.0.1');
}

export async function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  let resolveCallback!: (result: CallbackResult) => void;
  let rejectCallback!: (error: Error) => void;
  let settled = false;
  let waitRequested = false;

  const waitForCallback = new Promise<CallbackResult>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  const server = createServer((request, response) => {
    const requestUrl = buildRequestUrl(request);

    if (request.method !== 'GET' || requestUrl.pathname !== '/callback') {
      sendText(response, 404, 'Not found');
      return;
    }

    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');

    if (!code || !state) {
      if (!settled) {
        settled = true;
        rejectCallback(new Error('Missing callback code or state.'));
      }

      sendText(response, 400, 'Missing code or state');
      return;
    }

    if (state !== expectedState) {
      if (!settled) {
        settled = true;
        rejectCallback(new Error('Invalid callback state.'));
      }

      sendText(response, 400, 'Invalid callback state');
      return;
    }

    if (!settled) {
      settled = true;
      resolveCallback({ code, state });
    }

    sendText(response, 200, 'Login complete. You can close this tab.');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Callback server failed to bind to a port.');
  }

  const redirectUri = `http://127.0.0.1:${address.port}/callback`;

  return {
    redirectUri,
    waitForCallback: () => {
      waitRequested = true;
      return waitForCallback;
    },
    close: async () => {
      if (waitRequested && !settled) {
        settled = true;
        rejectCallback(new Error('Callback server closed before receiving a callback.'));
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}
