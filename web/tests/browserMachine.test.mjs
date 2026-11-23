import test from 'node:test';
import assert from 'node:assert/strict';
import { respondLocalIdentity } from '../server/localIdentity.mjs';
import { detectBrowserMachine } from '../src/browserMachine.ts';

const ORIGIN = 'http://100.76.74.124:4190';

function identity({ host = 'noha', port = 4191, origin = ORIGIN,
  address = '127.0.0.1', method = 'GET', hostname = `127.0.0.1:${port}` } = {}) {
  let status = null, body = '';
  const headers = {};
  const req = { url: '/api/local-machine', method,
    socket: { remoteAddress: address }, headers: { host: hostname, origin } };
  const res = { setHeader(key, value) { headers[key] = value; },
    writeHead(code) { status = code; }, end(value = '') { body = value; } };
  assert.equal(respondLocalIdentity(req, res, { hostId: host, port, origin: ORIGIN }), true);
  return { status, body, headers };
}

test('only trusted same-machine browser reads local machine identity', () => {
  assert.equal(JSON.parse(identity().body).hostId, 'noha');
  assert.equal(identity({ host: '6v', port: 4190 }).status, 200);
  assert.equal(identity({ address: '100.96.30.32' }).status, 403);
  assert.equal(identity({ origin: 'https://other.example' }).status, 403);
  assert.equal(identity({ hostname: '100.96.30.32:4191' }).status, 403);
  const preflight = identity({ method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Private-Network'], 'true');
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], ORIGIN);
});

test('browser auto-detects only one confirmed loopback service', async () => {
  const fake = (online) => async (url) => {
    const host = url.includes('4190') ? '6v' : 'noha';
    if (!online.includes(host)) throw Error('offline');
    return { ok: true, json: async () => ({ hostId: host }) };
  };
  assert.equal(await detectBrowserMachine(fake(['noha'])), 'noha');
  assert.equal(await detectBrowserMachine(fake(['6v'])), '6v');
  assert.equal(await detectBrowserMachine(fake([])), null);
  assert.equal(await detectBrowserMachine(fake(['6v', 'noha'])), null);
  assert.equal(await detectBrowserMachine(async () => ({ ok: true,
    json: async () => ({ hostId: 'wrong' }) })), null);
});
