import * as SecureStore from 'expo-secure-store';
import type { Host } from '../core/host';

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
  const text = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, Tokens>; }
  catch { return {}; }
}

export async function storeTokens(host: Host, wire: WireToken): Promise<void> {
  const current = await readAll();
  current[host.id] = {
    accessToken: wire.access_token,
    refreshToken: wire.refresh_token,
    expiresAt: Date.now() + wire.expires_in * 1000,
  };
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(current));
}

export async function hasTokens(host: Host): Promise<boolean> {
  return Boolean((await readAll())[host.id]?.refreshToken);
}

const inflight = new Map<string, Promise<string>>();

/** Refresh tokens only over HTTPS, rotating before expiry. */
export async function accessToken(host: Host): Promise<string> {
  if (inflight.has(host.id)) return inflight.get(host.id)!;
  const p = (async () => {
    const sessions = await readAll();
    const tokens = sessions[host.id];
    if (!tokens) throw new Error('本机尚未通过 OAuth 授权');
    if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
    const response = await fetch(host.baseUrl + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: tokens.refreshToken,
      }).toString(),
    });
    if (!response.ok) throw new Error('OAuth 凭据过期，请重新授权');
    const wire = await response.json() as WireToken;
    await storeTokens(host, wire);
    return wire.access_token;
  })();
  inflight.set(host.id, p);
  try { return await p; }
  finally { inflight.delete(host.id); }
}

export async function clearTokens(host: Host): Promise<void> {
  const sessions = await readAll();
  delete sessions[host.id];
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(sessions));
}
