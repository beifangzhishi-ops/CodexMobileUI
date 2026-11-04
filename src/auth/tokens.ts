import * as SecureStore from 'expo-secure-store';
import type { Host } from '../core/host';
import { logDiagnostic } from '../diagnostics/journal';
import { classifyDiagnosticError } from '../diagnostics/safe';

const STORAGE_KEY = 'codexmobileui.oauth.sessions';
export const CLIENT_ID = 'codexmobileui-android';
export const REDIRECT_URI = 'codexmobileui://oauth';

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface WireToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function readAll(): Promise<Record<string, Tokens>> {
  const startedAt = Date.now();
  logDiagnostic('storage.secureReadStarted');
  let text: string | null;
  try {
    text = await SecureStore.getItemAsync(STORAGE_KEY);
  } catch (error) {
    logDiagnostic('storage.secureReadFailed', {
      durationMs: Date.now() - startedAt, ...classifyDiagnosticError(error),
    });
    throw error;
  }
  logDiagnostic('storage.secureReadFinished', {
    durationMs: Date.now() - startedAt, codePresent: Boolean(text),
  });
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, Tokens>; }
  catch { return {}; }
}

export async function storeTokens(host: Host, wire: WireToken): Promise<void> {
  logDiagnostic('storage.tokenSaveStarted');
  const current = await readAll();
  current[host.id] = {
    accessToken: wire.access_token,
    refreshToken: wire.refresh_token,
    expiresAt: Date.now() + wire.expires_in * 1000,
  };
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(current));
  logDiagnostic('storage.tokenSaveFinished');
}

export async function hasTokens(host: Host): Promise<boolean> {
  const found = Boolean((await readAll())[host.id]?.refreshToken);
  logDiagnostic('storage.tokenLookupFinished', { codePresent: found });
  return found;
}

const inflight = new Map<string, Promise<string>>();

/** Refresh tokens only over HTTPS, rotating before expiry. */
export async function accessToken(host: Host): Promise<string> {
  if (inflight.has(host.id)) {
    logDiagnostic('auth.refreshJoined');
    return inflight.get(host.id)!;
  }
  const p = (async () => {
    const startedAt = Date.now();
    logDiagnostic('auth.accessTokenStarted');
    const sessions = await readAll();
    const tokens = sessions[host.id];
    if (!tokens) {
      logDiagnostic('auth.accessTokenMissing');
      throw new Error('本机尚未通过 OAuth 授权');
    }
    if (tokens.expiresAt - Date.now() > 60_000) {
      logDiagnostic('auth.accessTokenCached');
      return tokens.accessToken;
    }
    logDiagnostic('auth.refreshRequestStarted');
    let response: Response;
    try {
      response = await fetch(host.baseUrl + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: tokens.refreshToken,
      }).toString(),
      });
    } catch (error) {
      logDiagnostic('auth.refreshNetworkFailed', {
        durationMs: Date.now() - startedAt, ...classifyDiagnosticError(error),
      });
      throw error;
    }
    logDiagnostic('auth.refreshHttpReceived', {
      status: response.status, durationMs: Date.now() - startedAt,
    });
    if (!response.ok) throw new Error('OAuth 凭据过期，请重新授权');
    const wire = await response.json() as WireToken;
    await storeTokens(host, wire);
    logDiagnostic('auth.refreshFinished', { durationMs: Date.now() - startedAt });
    return wire.access_token;
  })();
  inflight.set(host.id, p);
  try { return await p; }
  finally { inflight.delete(host.id); }
}

export async function clearTokens(host: Host): Promise<void> {
  logDiagnostic('storage.tokenClearStarted');
  const sessions = await readAll();
  delete sessions[host.id];
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(sessions));
  logDiagnostic('storage.tokenClearFinished');
}
