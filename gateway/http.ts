import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthorizationError, OAuthStore, PUBLIC_CLIENT_ID, type AuthorizationRequest } from './oauth.js';
import { classifyGatewayClient, classifyGatewayRoute, type GatewayTrace } from './diagnostics.js';

const htmlHeader = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function send(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<URLSearchParams> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk as Buffer);
    size += buf.length;
    if (size > 8192) throw new AuthorizationError('invalid_request');
    parts.push(buf);
  }
  if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
    throw new AuthorizationError('invalid_request');
  }
  return new URLSearchParams(Buffer.concat(parts).toString('utf8'));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** CCM-style form: round-trip escaped and validated OAuth request fields. */
function consentPage(request: AuthorizationRequest, errorMessage = ''): string {
  const fields = [
    ['client_id', request.clientId],
    ['redirect_uri', request.redirectUri],
    ['response_type', 'code'],
    ['code_challenge', request.challenge],
    ['code_challenge_method', 'S256'],
    ['state', request.state],
  ];
  const hidden = fields.map(([name, value]) =>
    `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('');
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>授权 CodexMobileUI</title>
<style>body{font:16px system-ui;background:#10151e;color:#f7fafc;max-width:440px;margin:12vh auto;padding:24px}
input,button{box-sizing:border-box;width:100%;padding:14px;margin:12px 0;border-radius:12px;font-size:16px}
button{background:#bed7ff;border:0;color:#0b1626;font-weight:bold}
input{background:#1d2838;color:white;border:1px solid #65758b}
.error{color:#ffb1a8;border:1px solid #82534f;padding:12px;border-radius:8px}</style>
</head><body><h1>授权手机访问 Codex</h1>
<p>确认正在为自己的手机连接本电脑。授权后手机可读写此机 Codex 会话，请勿在他人设备上授权。</p>
<form method="POST" action="/oauth/consent">
${errorMessage ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>` : ''}
${hidden}
<label for="secret">本机网关设置的授权密语</label>
<input id="secret" name="approval_secret" type="password" autocomplete="off" required>
<button type="submit">确认授权并返回应用</button></form>
<p>请使用与本页电脑地址对应的本机授权密钥。授权成功后将返回 CodexMobileUI。</p>
</body></html>`;
}

const invalidPage = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>授权请求无效</title></head><body style="font:16px system-ui;background:#10151e;color:#f7fafc;padding:24px">
<h1>授权请求无效</h1>
<p>授权参数无效。请关闭此页面，从 CodexMobileUI 重新发起授权。</p>
</body></html>`;

export type OAuthAuditEvent =
  'consent_denied' | 'consent_granted' | 'authorization_invalid' |
  'oauth_invalid_grant' | 'oauth_token_issued' | 'oauth_token_refreshed';

/** No consent values, URLs, codes, access tokens, refresh tokens or secrets. */
function defaultAudit(event: OAuthAuditEvent): void {
  console.warn(`[mobile-oauth] ${new Date().toISOString()} ${event}`);
}

export function createHttpHandler(
  store: OAuthStore, baseUrl: string,
  audit: (event: OAuthAuditEvent) => void = defaultAudit,
  trace?: (event: GatewayTrace) => void,
) {
  let requestSequence = 0;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const requestId = ++requestSequence;
    const method = req.method === 'GET' ? 'GET' : req.method === 'POST' ? 'POST' : 'OTHER';
    const route = classifyGatewayRoute(req.url ?? '/');
    const client = classifyGatewayClient(
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    );
    const started = Date.now();
    const record = (event: GatewayTrace['event'], extra: Partial<GatewayTrace> = {}) => {
      trace?.({ event, requestId, route, method, client, ...extra });
    };
    record('http.received');
    res.once('finish', () => {
      record('http.finished', { status: res.statusCode, elapsedMs: Date.now() - started });
    });
    res.once('close', () => {
      if (!res.writableFinished) record('http.aborted', { elapsedMs: Date.now() - started });
    });
    const recordAudit = (event: OAuthAuditEvent) => {
      audit(event);
      record('oauth.decision', { decision: event });
    };
    try {
      const url = new URL(req.url ?? '/', baseUrl);
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, { status: 'ok', name: 'codex-mobile-gateway' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
        send(res, 200, {
          issuer: baseUrl,
          authorization_endpoint: baseUrl + '/oauth/authorize',
          token_endpoint: baseUrl + '/oauth/token',
          revocation_endpoint: baseUrl + '/oauth/revoke',
          grant_types_supported: ['authorization_code', 'refresh_token'],
          response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
        const request = store.validateRequest(url.searchParams);
        const consent = new URL('/oauth/consent', baseUrl);
        consent.searchParams.set('client_id', request.clientId);
        consent.searchParams.set('redirect_uri', request.redirectUri);
        consent.searchParams.set('response_type', 'code');
        consent.searchParams.set('code_challenge', request.challenge);
        consent.searchParams.set('code_challenge_method', 'S256');
        consent.searchParams.set('state', request.state);
        res.writeHead(302, { Location: consent.toString(), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (url.pathname === '/oauth/consent' &&
          (req.method === 'GET' || req.method === 'POST')) {
        const data = req.method === 'POST' ? await body(req) : url.searchParams;
        let request: AuthorizationRequest;
        try {
          request = store.validateRequest(data);
        } catch (error) {
          recordAudit('authorization_invalid');
          res.writeHead(400, htmlHeader);
          res.end(invalidPage);
          return;
        }
        if (req.method === 'GET') {
          res.writeHead(200, htmlHeader);
          res.end(consentPage(request));
          return;
        }
        let location: string;
        try {
          location = store.approve(request, data.get('approval_secret') ?? '');
        } catch (error) {
          if (!(error instanceof AuthorizationError) || error.code !== 'access_denied') throw error;
          recordAudit('consent_denied');
          res.writeHead(403, htmlHeader);
          res.end(consentPage(request, '授权密钥不正确，请核对当前电脑对应的密钥并重试。'));
          return;
        }
        recordAudit('consent_granted');
        res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/oauth/token') {
        const data = await body(req);
        if (data.get('client_id') !== PUBLIC_CLIENT_ID) throw new AuthorizationError('invalid_client');
        const grantType = data.get('grant_type');
        const tokens = grantType === 'authorization_code'
          ? store.exchange(data.get('code') ?? '', data.get('code_verifier') ?? '', data.get('redirect_uri') ?? '')
          : grantType === 'refresh_token'
            ? store.refresh(data.get('refresh_token') ?? '')
            : null;
        if (!tokens) throw new AuthorizationError('unsupported_grant_type');
        recordAudit(grantType === 'refresh_token' ? 'oauth_token_refreshed' : 'oauth_token_issued');
        send(res, 200, tokens);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/oauth/revoke') {
        const data = await body(req);
        if (data.get('client_id') !== PUBLIC_CLIENT_ID) throw new AuthorizationError('invalid_client');
        store.revoke(data.get('token') ?? '');
        send(res, 200, {});
        return;
      }
      send(res, 404, { error: 'not_found' });
    } catch (error) {
      const code = error instanceof AuthorizationError ? error.code : 'server_error';
      if (code === 'invalid_grant' && (req.url ?? '').startsWith('/oauth/token')) {
        recordAudit('oauth_invalid_grant');
      }
      send(res, code === 'server_error' ? 500 : 400, { error: code });
    }
  };
}
