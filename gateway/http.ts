import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthorizationError, OAuthStore, PUBLIC_CLIENT_ID } from './oauth.js';

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

const consentPage = (intent: string) => `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>授权 CodexMobileUI</title>
<style>body{font:16px system-ui;background:#10151e;color:#f7fafc;max-width:440px;margin:12vh auto;padding:24px}
input,button{box-sizing:border-box;width:100%;padding:14px;margin:12px 0;border-radius:12px;font-size:16px}
button{background:#bed7ff;border:0;color:#0b1626;font-weight:bold}
input{background:#1d2838;color:white;border:1px solid #65758b}</style>
</head><body><h1>授权手机访问 Codex</h1>
<p>确认正在为自己的手机连接本电脑。授权后手机可读写此机 Codex 会话，请勿在他人设备上授权。</p>
<form method="POST" action="/oauth/approve">
<input type="hidden" name="intent" value="${intent}">
<label for="secret">本机网关设置的授权密语</label>
<input id="secret" name="approval_secret" type="password" autocomplete="off" required>
<button type="submit">确认授权</button></form></body></html>`;

export function createHttpHandler(store: OAuthStore, baseUrl: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
        const intent = store.begin(url.searchParams);
        res.writeHead(200, htmlHeader);
        res.end(consentPage(intent));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/oauth/approve') {
        const data = await body(req);
        const location = store.approve(data.get('intent') ?? '', data.get('approval_secret') ?? '');
        res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (req.method === 'POST' && url.pathname === '/oauth/token') {
        const data = await body(req);
        if (data.get('client_id') !== PUBLIC_CLIENT_ID) throw new AuthorizationError('invalid_client');
        const tokens = data.get('grant_type') === 'authorization_code'
          ? store.exchange(data.get('code') ?? '', data.get('code_verifier') ?? '', data.get('redirect_uri') ?? '')
          : data.get('grant_type') === 'refresh_token'
            ? store.refresh(data.get('refresh_token') ?? '')
            : null;
        if (!tokens) throw new AuthorizationError('unsupported_grant_type');
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
      send(res, code === 'server_error' ? 500 : 400, { error: code });
    }
  };
}
