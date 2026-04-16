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
  const pendingResults: CallbackResult[] = [];
  const waiters: Array<{
    resolve: (result: CallbackResult) => void;
    reject: (error: Error) => void;
  }> = [];
  let waitRequested = false;

  function rejectNextWaiter(error: Error) {
    const waiter = waiters.shift();
    if (!waiter) {
      return;
    }

    waiter.reject(error);
  }

  function resolveNextWaiter(result: CallbackResult) {
    const waiter = waiters.shift();
    if (!waiter) {
      pendingResults.push(result);
      return;
    }

    waiter.resolve(result);
  }

  const server = createServer((request, response) => {
    const requestUrl = buildRequestUrl(request);

    if (request.method !== 'GET' || requestUrl.pathname !== '/callback') {
      sendText(response, 404, 'Not found');
      return;
    }

    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');

    if (!code || !state) {
      rejectNextWaiter(new Error('Missing callback code or state.'));
      sendText(response, 400, 'Missing code or state');
      return;
    }

    if (state !== expectedState) {
      rejectNextWaiter(new Error('Invalid callback state.'));
      sendText(response, 400, 'Invalid callback state');
      return;
    }

    resolveNextWaiter({ code, state });
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

      if (pendingResults.length > 0) {
        return Promise.resolve(pendingResults.shift() as CallbackResult);
      }

      return new Promise<CallbackResult>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    close: async () => {
      if (waitRequested && waiters.length > 0) {
        for (const waiter of waiters.splice(0)) {
          waiter.reject(
            new Error('Callback server closed before receiving a callback.')
          );
        }
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
