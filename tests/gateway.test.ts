import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createHttpHandler, type OAuthAuditEvent } from '../gateway/http';
import { createGateway } from '../gateway/main';
import { OAuthStore, PUBLIC_CLIENT_ID } from '../gateway/oauth';

const SECRET = 'gateway-test-only-secret-is-long-enough';
const VERIFIER = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_~';
const REDIRECT = 'codexmobileui://oauth';

test('CCM-style consent survives delay, supports retry and logs only safe events', async () => {
  const directory = resolve('.tmp', 'consent-retry-' + randomUUID());
  mkdirSync(directory, { recursive: true });
  const events: OAuthAuditEvent[] = [];
  const store = new OAuthStore(SECRET, REDIRECT, resolve(directory, 'state.json'));
  const httpServer = createServer(createHttpHandler(
    store, 'https://gateway.example.test', (event) => events.push(event),
  ));
  await new Promise<void>((accept, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', accept);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('test server did not listen');
  const base = `http://127.0.0.1:${address.port}`;
  const postConsent = (params: URLSearchParams, secret: string) => fetch(base + '/oauth/consent', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...Object.fromEntries(params), approval_secret: secret }),
  });
  const getConsent = async (): Promise<URLSearchParams> => {
    const params = new URLSearchParams({
      client_id: PUBLIC_CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      state: 'retry-test-csrf-12345678',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(VERIFIER).digest('base64url'),
    });
    const authorize = await fetch(base + '/oauth/authorize?' + params, { redirect: 'manual' });
    assert.equal(authorize.status, 302);
    const consent = await fetch(base + '/oauth/consent?' + params);
    assert.equal(consent.status, 200);
    const form = await consent.text();
    assert.match(form, /name="code_challenge"/);
    assert.match(form, /name="state"/);
    assert.doesNotMatch(form, /name="intent"/);
    return params;
  };
  try {
    const firstRequest = await getConsent();
    const denied = await postConsent(firstRequest, 'incorrect-private-value');
    assert.equal(denied.status, 403);
    const retryPage = await denied.text();
    assert.match(retryPage, /<form method="POST" action="\/oauth\/consent">/);
    assert.match(retryPage, /role="alert"/);
    assert.ok(retryPage.includes(`name="state" value="${firstRequest.get('state')}"`));
    assert.doesNotMatch(retryPage, /incorrect-private-value/);
    assert.doesNotMatch(retryPage, new RegExp(SECRET));
    assert.equal(events[0], 'consent_denied');
    // No transient intent: the same browser form remains valid and testable after delay.
    const accepted = await postConsent(firstRequest, SECRET);
    assert.equal(accepted.status, 302);
    assert.match(accepted.headers.get('location') ?? '', /^codexmobileui:\/\/oauth\?/);

    assert.equal(events[1], 'consent_granted');
    const badRequest = new URLSearchParams(firstRequest);
    badRequest.set('redirect_uri', 'https://untrusted.example/path');
    const invalid = await postConsent(badRequest, SECRET);
    assert.equal(invalid.status, 400);
    assert.match(await invalid.text(), /授权请求无效/);
    assert.equal(events.at(-1), 'authorization_invalid');
    assert.ok(events.every((event) =>
      ['consent_denied', 'consent_granted', 'authorization_invalid'].includes(event)));
  } finally {
    await new Promise<void>((done) => httpServer.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('OAuth PKCE → authenticated WSS gateway → actual JSON-RPC relay', async () => {
  const directory = resolve('.tmp', 'integration-' + randomUUID());
  mkdirSync(directory, { recursive: true });
  const backend = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((accept, reject) => {
    if (backend.address()) { accept(); return; }
    backend.once('listening', () => accept());
    backend.once('error', reject);
  });
  const backendPort = (backend.address() as { port: number }).port;
  let upstreamMessage = '';
  backend.on('connection', (ws) => {
    ws.on('message', (data) => {
      upstreamMessage = data.toString();
      const request = JSON.parse(upstreamMessage) as { id: number };
      ws.send(JSON.stringify({ id: request.id, result: { success: true } }));
    });
  });
  const gateway = createGateway({
    publicOrigin: 'https://gateway.example.test',
    redirectUri: REDIRECT, secret: SECRET,
    stateFile: resolve(directory, 'tokens.json'), listenPort: 0,
    upstream: `ws://127.0.0.1:${backendPort}`,
  });
  await gateway.listen();
  const base = `http://127.0.0.1:${gateway.port()}`;
  let client: WebSocket | null = null;
  try {
    const authorization = new URLSearchParams({
      client_id: PUBLIC_CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      state: 'random-csrf-state-123',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(VERIFIER).digest('base64url'),
    });
    const authorizationRedirect = await fetch(base + '/oauth/authorize?' + authorization, { redirect: 'manual' });
    assert.equal(authorizationRedirect.status, 302);
    const consent = await fetch(base + '/oauth/consent?' + authorization);
    assert.equal(consent.status, 200);
    assert.match(await consent.text(), /name="code_challenge"/);
    const approval = await fetch(base + '/oauth/consent', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({ ...Object.fromEntries(authorization), approval_secret: SECRET }),
    });
    assert.equal(approval.status, 302);
    const authCode = new URL(approval.headers.get('location')!).searchParams.get('code');
    assert.ok(authCode);
    const tokenReply = await fetch(base + '/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', client_id: PUBLIC_CLIENT_ID,
        code: authCode, code_verifier: VERIFIER, redirect_uri: REDIRECT,
      }),
    });
    assert.equal(tokenReply.status, 200);
    const token = await tokenReply.json() as { access_token: string };
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/connect');
    client = ws;
    const result = await new Promise<Record<string, unknown>>((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error('relay timed out')), 2500);
      ws.on('open', () => ws.send(JSON.stringify({
        type: 'authenticate', accessToken: token.access_token,
      })));
      ws.on('message', (bytes) => {
        const data = JSON.parse(bytes.toString()) as Record<string, unknown>;
        if (data.type === 'ready') {
          ws.send(JSON.stringify({ id: 17, method: 'initialize', params: {} }));
        } else if (data.id === 17) {
          clearTimeout(timeout);
          accept(data);
        }
      });
      ws.on('error', reject);
    });
    assert.deepEqual(result.result, { success: true });
    assert.match(upstreamMessage, /"method":"initialize"/);
    const denied = await new Promise<Record<string, unknown>>((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error('blocked RPC timed out')), 2500);
      ws.on('message', (bytes) => {
        const data = JSON.parse(bytes.toString()) as Record<string, unknown>;
        if (data.id === 18) {
          clearTimeout(timeout);
          accept(data);
        }
      });
      ws.send(JSON.stringify({ id: 18, method: 'config/set', params: { dangerous: true } }));
    });
    assert.equal((denied.error as { code: number }).code, -32601);
    assert.match(upstreamMessage, /"method":"initialize"/, 'forbidden RPC never reaches Codex');
  } catch (error) {
    console.error('Gateway integration failure:', error);
    throw error;
  } finally {
    client?.terminate();
    await gateway.close();
    for (const connection of backend.clients) connection.terminate();
    await new Promise<void>((done) => backend.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('unauthorized websocket cannot reach upstream', async () => {
  const directory = resolve('.tmp', 'bad-auth-' + randomUUID());
  mkdirSync(directory, { recursive: true });
  const gateway = createGateway({
    publicOrigin: 'https://gateway.example.test',
    redirectUri: REDIRECT, secret: SECRET,
    stateFile: resolve(directory, 'tokens.json'), listenPort: 0,
    upstream: 'ws://127.0.0.1:65531',
  });
  await gateway.listen();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${gateway.port()}/connect`);
    const code = await new Promise<number>((accept, reject) => {
      ws.on('open', () => ws.send('{"type":"authenticate","accessToken":"invalid"}'));
      ws.on('close', (status) => accept(status));
      ws.on('error', reject);
    });
    assert.equal(code, 4001);
  } finally {
    await gateway.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
