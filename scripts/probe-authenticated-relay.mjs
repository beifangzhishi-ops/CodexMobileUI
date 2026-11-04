/**
 * Read-only, on-host smoke test of the *complete* local OAuth + relay path
 * against an already-running shared Codex App Server. Never logs secrets
 * or any thread IDs, paths, names, or transcript content.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import WebSocket from 'ws';
import { createGateway } from '../dist/gateway/main.js';

const directory = resolve('.tmp', 'authenticated-probe-' + randomUUID());
mkdirSync(directory, { recursive: true });
const secret = randomBytes(32).toString('base64url');
const verifier = randomBytes(48).toString('base64url');
const redirectUri = 'codexmobileui://oauth';
const gateway = createGateway({
  publicOrigin: 'https://localhost.invalid',
  upstream: process.env.CODEX_APP_SERVER_WS ?? 'ws://127.0.0.1:45789',
  secret, redirectUri, listenPort: 0,
  stateFile: resolve(directory, 'auth.json'),
});
let socket;
try {
  await gateway.listen();
  const base = `http://127.0.0.1:${gateway.port()}`;
  const consentParams = new URLSearchParams({
    response_type: 'code', client_id: 'codexmobileui-android',
    redirect_uri: redirectUri,
    state: 'localhost-readonly-' + randomUUID(),
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  const authorizationRedirect = await fetch(base + '/oauth/authorize?' + consentParams, {
    redirect: 'manual',
  });
  if (authorizationRedirect.status !== 302) throw new Error('authorization redirect failed');
  const consent = await fetch(base + '/oauth/consent?' + consentParams);
  if (!consent.ok) throw new Error('authorization request failed');
  if (!(await consent.text()).includes('name="code_challenge"')) {
    throw new Error('missing PKCE consent fields');
  }
  const approved = await fetch(base + '/oauth/consent', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...Object.fromEntries(consentParams), approval_secret: secret,
    }),
  });
  if (approved.status !== 302) throw new Error('owner OAuth approval rejected');
  const code = new URL(approved.headers.get('location')).searchParams.get('code');
  const tokenResponse = await fetch(base + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'codexmobileui-android',
      redirect_uri: redirectUri, code, code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error('OAuth code exchange failed');
  const token = (await tokenResponse.json()).access_token;
  socket = new WebSocket(base.replace('http:', 'ws:') + '/connect', { handshakeTimeout: 3000 });
  const result = await new Promise((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('backend read-only RPC timeout')), 9000);
    const finish = (value, error) => {
      clearTimeout(timeout);
      if (error) reject(error);
      else accept(value);
    };
    socket.once('open', () =>
      socket.send(JSON.stringify({ type: 'authenticate', accessToken: token })));
    socket.on('message', (raw) => {
      let reply;
      try { reply = JSON.parse(raw.toString()); } catch { return; }
      if (reply.type === 'ready') {
        socket.send(JSON.stringify({
          id: 1, method: 'initialize',
          params: {
            clientInfo: { name: 'codexmobileui_authenticated_readonly_probe', version: '0.1.0' },
            capabilities: { experimentalApi: true },
          },
        }));
      } else if (reply.id === 1) {
        if (reply.error) return finish(null, new Error('Codex rejected initialize'));
        socket.send(JSON.stringify({ method: 'initialized', params: {} }));
        socket.send(JSON.stringify({
          id: 2, method: 'thread/list', params: { limit: 1, sortKey: 'recency_at' },
        }));
      } else if (reply.id === 2) {
        if (reply.error) return finish(null, new Error('Codex rejected thread/list'));
        finish(true);
      }
    });
    socket.once('error', (error) => finish(null, error));
    socket.once('close', () => finish(null, new Error('gateway connection closed')));
  });
  if (result) console.log('authenticated_shared_thread_list_ok');
} catch (error) {
  console.error('authenticated_shared_probe_failed:' +
    (error instanceof Error ? error.message : 'unknown'));
  process.exitCode = 1;
} finally {
  socket?.terminate();
  await gateway.close();
  rmSync(directory, { recursive: true, force: true });
}
