import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createGateway } from '../gateway/main';
import { PUBLIC_CLIENT_ID } from '../gateway/oauth';

const SECRET = 'gateway-test-only-secret-is-long-enough';
const VERIFIER = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_~';
const REDIRECT = 'codexmobileui://oauth';

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
    const consent = await fetch(base + '/oauth/authorize?' + authorization);
    assert.equal(consent.status, 200);
    const intent = (await consent.text()).match(/name="intent" value="([^"]+)"/)?.[1];
    assert.ok(intent);
    const approval = await fetch(base + '/oauth/approve', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({ intent, approval_secret: SECRET }),
    });
    assert.equal(approval.status, 303);
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
