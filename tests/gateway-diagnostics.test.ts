import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, get } from 'node:http';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyGatewayClient, classifyGatewayRoute, createGatewayJournal,
  sanitizeGatewayTrace, type GatewayTrace,
} from '../gateway/diagnostics';
import { createHttpHandler } from '../gateway/http';
import { OAuthStore, PUBLIC_CLIENT_ID } from '../gateway/oauth';

test('gateway request log stores only allowlisted metadata', () => {
  assert.equal(classifyGatewayRoute('/oauth/authorize?state=SECRET-CODE'), 'oauth.authorize');
  assert.equal(classifyGatewayRoute('/oauth/anything-private?token=SECRET'), 'other');
  assert.equal(classifyGatewayClient('Mozilla/5.0 (Linux; Android 15; PRIVATE)'), 'android');
  assert.equal(classifyGatewayClient('undici'), 'automation');
  const injected = sanitizeGatewayTrace({
    event: 'http.finished',
    route: 'oauth.authorize',
    method: 'GET',
    status: 302,
    elapsedMs: 4,
    requestId: 12,
    client: 'android',
    rawUrl: 'https://secret-host/?token=PRIVATE',
    accessToken: 'PRIVATE',
  } as GatewayTrace);
  assert.deepEqual(injected, {
    event: 'http.finished', route: 'oauth.authorize',
    method: 'GET', status: 302, elapsedMs: 4, requestId: 12, client: 'android',
  });
  assert.doesNotMatch(JSON.stringify(injected), /PRIVATE|secret-host/);
});

test('gateway lifecycle RPC traces whitelist method, sequence, outcome and duration only', () => {
  const safe = sanitizeGatewayTrace({
    event: 'rpc.completed', rpcMethod: 'thread/delete', rpcRequestId: 42,
    rpcOutcome: 'error', elapsedMs: 25_001,
    requestId: 3,
    threadId: 'SECRET-THREAD-ID',
    params: { threadId: 'SECRET-THREAD-ID' },
    errorMessage: 'SECRET-SERVER-ERROR',
  } as unknown as GatewayTrace);
  assert.deepEqual(safe, {
    event: 'rpc.completed', rpcMethod: 'thread/delete', rpcRequestId: 42,
    rpcOutcome: 'error', elapsedMs: 25_001, requestId: 3,
  });
  assert.doesNotMatch(JSON.stringify(safe), /SECRET/);
  const invalid = sanitizeGatewayTrace({
    event: 'rpc.completed', rpcMethod: 'some/private/method',
    rpcOutcome: 'my-private-error', rpcRequestId: -1,
  } as unknown as GatewayTrace);
  assert.deepEqual(invalid, { event: 'rpc.completed' });
});

test('gateway persists received/finished events before and after OAuth HTTP requests', async () => {
  const directory = resolve('.tmp', 'gateway-diagnostics-' + randomUUID());
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, 'gateway-requests.jsonl');
  const journal = createGatewayJournal(file);
  const store = new OAuthStore(
    'gateway-test-only-secret-is-long-enough',
    'codexmobileui://oauth',
    resolve(directory, 'oauth.json'),
  );
  const server = createServer(createHttpHandler(
    store, 'https://gateway.example.test', () => {}, journal.append,
  ));
  try {
    await new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('test port unavailable');
    const base = 'http://127.0.0.1:' + addr.port;
    const params = new URLSearchParams({
      client_id: PUBLIC_CLIENT_ID,
      redirect_uri: 'codexmobileui://oauth',
      response_type: 'code',
      state: 'PRIVATE-STATE-SHOULD-NOT-LEAK',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update('PRIVATE-VERIFIER').digest('base64url'),
    });
    // Native HTTP requests can use ephemeral ports that the Fetch API blocks
    // as "bad port" (e.g. 6000); this test checks journaling, not Fetch policy.
    const requestStatus = (url: string, headers?: Record<string, string>) =>
      new Promise<number>((resolveStatus, rejectStatus) => {
        const request = get(url, { headers }, (response) => {
          response.resume();
          response.on('end', () => resolveStatus(response.statusCode ?? 0));
          response.on('error', rejectStatus);
        });
        request.on('error', rejectStatus);
      });
    const responseStatus = await requestStatus(base + '/oauth/authorize?' + params,
      { 'user-agent': 'Mozilla/5.0 (Android; PRIVATE-UA)' });
    assert.equal(responseStatus, 302);
    const notFoundStatus = await requestStatus(base + '/PRIVATE-PATH?token=PRIVATE-TOKEN');
    assert.equal(notFoundStatus, 404);

    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /PRIVATE|gateway.example.test|127\.0\.0\.1/);
    const entries = content.trim().split('\n').map((line) => JSON.parse(line) as GatewayTrace);
    assert.deepEqual(entries.map((entry) => entry.event),
      ['http.received', 'http.finished', 'http.received', 'http.finished']);
    assert.equal(entries[0].route, 'oauth.authorize');
    assert.equal(entries[0].client, 'android');
    assert.equal(entries[0].method, 'GET');
    assert.equal(entries[1].status, 302);
    assert.equal(entries[2].route, 'other');
    assert.equal(entries[3].status, 404);
    assert.equal(entries[0].requestId, entries[1].requestId);
    assert.equal(entries[2].requestId, entries[3].requestId);
    assert.notEqual(entries[0].requestId, entries[2].requestId);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  }
});
