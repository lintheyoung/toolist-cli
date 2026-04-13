import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { apiRequest } from '../lib/http.js';
import { openBrowser } from '../lib/browser.js';
import { saveConfig, type ToollistConfig } from '../lib/config.js';
import { startCallbackServer, type CallbackServer } from '../lib/callback-server.js';

export interface LoginCommandArgs {
  baseUrl: string;
  clientName?: string;
  configPath?: string;
}

export interface LoginCommandResult {
  baseUrl: string;
  workspace: {
    id: number;
    name: string;
  };
  user: {
    id: number;
    email: string;
  };
  expiresAt: string;
}

export interface LoginDependencies {
  openBrowser: (url: string) => Promise<void>;
  startCallbackServer: (expectedState: string) => Promise<CallbackServer>;
  apiRequest: typeof apiRequest;
  saveConfig: typeof saveConfig;
  randomUUID: () => string;
  createCodeVerifier: () => string;
  createCodeChallenge: (codeVerifier: string) => string;
}

type LoginExchangeResponse = {
  data: {
    access_token: string;
    token_type: string;
    expires_at: string;
    workspace_id: number;
    workspace_name: string;
    user_id: number;
    user_email: string;
    base_url?: string;
    scopes?: string[];
  };
  request_id: string;
};

type LoginExchangePayload = {
  access_token: string;
  token_type: string;
  expires_at: string;
  workspace_id: number;
  workspace_name: string;
  user_id: number;
  user_email: string;
  base_url?: string;
  scopes?: string[];
};

function createDefaultCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function createDefaultCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function createDefaultDependencies(): LoginDependencies {
  return {
    openBrowser,
    startCallbackServer,
    apiRequest,
    saveConfig,
    randomUUID,
    createCodeVerifier: createDefaultCodeVerifier,
    createCodeChallenge: createDefaultCodeChallenge,
  };
}

export async function loginCommand(
  args: LoginCommandArgs,
  dependencies: Partial<LoginDependencies> = {},
): Promise<LoginCommandResult> {
  const deps = {
    ...createDefaultDependencies(),
    ...dependencies,
  };
  const state = deps.randomUUID();
  const codeVerifier = deps.createCodeVerifier();
  const codeChallenge = deps.createCodeChallenge(codeVerifier);
  const clientName = args.clientName ?? 'CLI';
  const { redirectUri, waitForCallback, close } = await deps.startCallbackServer(state);

  try {
    const startUrl = new URL('/api/cli/auth/start', args.baseUrl);
    startUrl.searchParams.set('redirect_uri', redirectUri);
    startUrl.searchParams.set('state', state);
    startUrl.searchParams.set('code_challenge', codeChallenge);
    startUrl.searchParams.set('client_name', clientName);
    startUrl.searchParams.set('base_url', args.baseUrl);

    await deps.openBrowser(startUrl.toString());

    const callback = await waitForCallback();
    const exchangeEnvelope = await deps.apiRequest<LoginExchangeResponse>({
      baseUrl: args.baseUrl,
      method: 'POST',
      path: '/api/cli/auth/exchange',
      body: {
        code: callback.code,
        state: callback.state,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    });
    const exchange: LoginExchangePayload = exchangeEnvelope.data;

    const baseUrl = exchange.base_url ?? args.baseUrl;
    const config: ToollistConfig = {
      baseUrl,
      accessToken: exchange.access_token,
    };

    await deps.saveConfig(config, args.configPath);

    return {
      baseUrl,
      workspace: {
        id: exchange.workspace_id,
        name: exchange.workspace_name,
      },
      user: {
        id: exchange.user_id,
        email: exchange.user_email,
      },
      expiresAt: exchange.expires_at,
    };
  } finally {
    await close();
  }
}
