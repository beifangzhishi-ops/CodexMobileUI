import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export type GatewayRoute =
  'oauth.authorize' | 'oauth.consent' | 'oauth.token' | 'oauth.confirm' | 'oauth.revoke' |
  'oauth.metadata' | 'health' | 'connect' | 'other';
export type GatewayClient = 'android' | 'ios' | 'desktop' | 'automation' | 'unknown';
export type GatewayEvent =
  'http.received' | 'http.finished' | 'http.aborted' | 'oauth.decision' |
  'gateway.started' | 'gateway.stopped' | 'gateway.logError' |
  'ws.received' | 'ws.rejected' | 'ws.upgraded' | 'ws.authAccepted' |
  'ws.authRejected' | 'ws.upstreamReady' | 'ws.upstreamFailed' | 'ws.closed' |
  'rpc.forwarded' | 'rpc.completed' | 'rpc.slow' | 'rpc.abandoned' |
  'rpc.forwardFailed' | 'rpc.notification';
export type GatewayRpcMethod = 'thread/delete' | 'thread/archive' | 'thread/unarchive' |
  'thread/deleted' | 'thread/archived' | 'thread/unarchived';
export type GatewayRpcOutcome = 'success' | 'error' | 'disconnect' | 'send_failed';
export type GatewayDecision =
  'consent_denied' | 'consent_granted' | 'authorization_invalid' |
  'oauth_invalid_grant' | 'oauth_token_issued' | 'oauth_token_refreshed' |
  'oauth_token_confirmed';

/** Never pass raw paths, query strings, headers, IPs, user agent strings,
 * request/response bodies, OAuth codes/states/verifiers or error text.
 */
export interface GatewayTrace {
  event: GatewayEvent;
  requestId?: number;
  route?: GatewayRoute;
  method?: 'GET' | 'POST' | 'OTHER';
  client?: GatewayClient;
  status?: number;
  closeCode?: number;
  elapsedMs?: number;
  decision?: GatewayDecision;
  rpcMethod?: GatewayRpcMethod;
  rpcRequestId?: number;
  rpcOutcome?: GatewayRpcOutcome;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const BACKUPS = 2;
const ROUTES: Record<string, GatewayRoute> = {
  '/oauth/authorize': 'oauth.authorize',
  '/oauth/consent': 'oauth.consent',
  '/oauth/token': 'oauth.token',
  '/oauth/refresh/confirm': 'oauth.confirm',
  '/oauth/revoke': 'oauth.revoke',
  '/.well-known/oauth-authorization-server': 'oauth.metadata',
  '/health': 'health',
  '/connect': 'connect',
};
const EVENTS = new Set<GatewayEvent>([
  'http.received', 'http.finished', 'http.aborted', 'oauth.decision',
  'gateway.started', 'gateway.stopped', 'gateway.logError',
  'ws.received', 'ws.rejected', 'ws.upgraded', 'ws.authAccepted',
  'ws.authRejected', 'ws.upstreamReady', 'ws.upstreamFailed', 'ws.closed',
  'rpc.forwarded', 'rpc.completed', 'rpc.slow', 'rpc.abandoned',
  'rpc.forwardFailed', 'rpc.notification',
]);
const RPC_METHODS = new Set<GatewayRpcMethod>([
  'thread/delete', 'thread/archive', 'thread/unarchive',
  'thread/deleted', 'thread/archived', 'thread/unarchived',
]);
const RPC_OUTCOMES = new Set<GatewayRpcOutcome>([
  'success', 'error', 'disconnect', 'send_failed',
]);
const DECISIONS = new Set<GatewayDecision>([
  'consent_denied', 'consent_granted', 'authorization_invalid',
  'oauth_invalid_grant', 'oauth_token_issued', 'oauth_token_refreshed',
  'oauth_token_confirmed',
]);

export function classifyGatewayRoute(rawUrl: string): GatewayRoute {
  try {
    const path = new URL(rawUrl, 'http://localhost').pathname;
    return Object.hasOwn(ROUTES, path) ? ROUTES[path] : 'other';
  } catch {
    return 'other';
  }
}

export function classifyGatewayClient(userAgent: string | undefined): GatewayClient {
  if (!userAgent) return 'unknown';
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/curl|node|undici|powershell|axios|python|postman/i.test(userAgent)) {
    return 'automation';
  }
  if (/mozilla|chrome|safari|firefox|edge/i.test(userAgent)) return 'desktop';
  return 'unknown';
}

export function sanitizeGatewayTrace(input: GatewayTrace): GatewayTrace {
  const safe: GatewayTrace = {
    event: EVENTS.has(input.event) ? input.event : 'gateway.logError',
  };
  if (typeof input.requestId === 'number' && Number.isSafeInteger(input.requestId)
      && input.requestId >= 0 && input.requestId < 1e12) safe.requestId = input.requestId;
  if (input.route && (input.route === 'other' || Object.values(ROUTES).includes(input.route))) {
    safe.route = input.route;
  }
  if (input.method === 'GET' || input.method === 'POST' || input.method === 'OTHER') {
    safe.method = input.method;
  }
  if (input.client && ['android', 'ios', 'desktop', 'automation', 'unknown'].includes(input.client)) {
    safe.client = input.client;
  }
  if (typeof input.status === 'number' && Number.isInteger(input.status) &&
      input.status >= 100 && input.status <= 599) safe.status = input.status;
  if (typeof input.closeCode === 'number' && Number.isInteger(input.closeCode) &&
      input.closeCode >= 1000 && input.closeCode <= 4999) safe.closeCode = input.closeCode;
  if (typeof input.elapsedMs === 'number' && Number.isFinite(input.elapsedMs)) {
    safe.elapsedMs = Math.max(0, Math.min(Math.floor(input.elapsedMs), 86_400_000));
  }
  if (input.decision && DECISIONS.has(input.decision)) safe.decision = input.decision;
  if (input.rpcMethod && RPC_METHODS.has(input.rpcMethod)) safe.rpcMethod = input.rpcMethod;
  if (typeof input.rpcRequestId === 'number' && Number.isSafeInteger(input.rpcRequestId) &&
      input.rpcRequestId >= 0 && input.rpcRequestId < 1_000_000_000) {
    safe.rpcRequestId = input.rpcRequestId;
  }
  if (input.rpcOutcome && RPC_OUTCOMES.has(input.rpcOutcome)) safe.rpcOutcome = input.rpcOutcome;
  return safe;
}

/** Durable bounded append; logging failures never change OAuth responses. */
export function createGatewayJournal(file = resolve('.state', 'mobile-gateway-requests.jsonl')) {
  const session = randomBytes(6).toString('hex');
  let disabled = false;
  let initialized = false;
  function append(input: GatewayTrace): void {
    if (disabled) return;
    try {
      if (!initialized) {
        mkdirSync(dirname(file), { recursive: true });
        initialized = true;
      }
      const data = JSON.stringify({
        v: 1, at: new Date().toISOString(), session, ...sanitizeGatewayTrace(input),
      }) + '\n';
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(data) > MAX_FILE_BYTES) {
        if (existsSync(file + '.' + BACKUPS)) unlinkSync(file + '.' + BACKUPS);
        for (let i = BACKUPS; i >= 2; --i) {
          const from = file + '.' + (i - 1);
          if (existsSync(from)) renameSync(from, file + '.' + i);
        }
        renameSync(file, file + '.1');
      }
      appendFileSync(file, data, { encoding: 'utf8', flag: 'a', mode: 0o600 });
    } catch {
      disabled = true;
      console.warn('[mobile-gateway] persistent request journal unavailable');
    }
  }
  return { append, file };
}
