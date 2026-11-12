import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { makeServer, fields, validateTokens } from '../scripts/visual-editor.mjs';

const savedPath = new URL('../src/ui/visual-tokens.json', import.meta.url);
const storedText = readFileSync(savedPath, 'utf8');
const initial = JSON.parse(storedText);

function callServer(port, route, { method = 'GET', origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: '127.0.0.1:49173' };
    if (method === 'POST') {
      headers.Origin = origin ?? 'http://127.0.0.1:49173';
      headers['Content-Type'] = 'application/json';
    }
    const request = http.request({
      hostname: '127.0.0.1', port, path: route, method, headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('all visual parameters have bounded saved defaults', () => {
  assert.equal(Object.keys(initial).length, Object.keys(fields).length);
  assert.deepEqual(validateTokens(initial), initial);
  assert.equal(validateTokens({ ...initial, composerMinHeight: 8000 }), null);
  assert.equal(validateTokens({ ...initial, composerRadius: 12.5 }), null);
  assert.equal(validateTokens({ ...initial, composerBackground: 'red' }), null);
  assert.equal(validateTokens({ ...initial, unexpected: 3 }), null);
  assert.equal(validateTokens(null), null);
});

test('local preview enforces origin, and preview does not change source files', async () => {
  const server = makeServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    let response = await callServer(port, '/health');
    assert.equal(response.status, 200);
    response = await callServer(port, '/api/config');
    assert.deepEqual(response.body.tokens, initial);
    const revision = response.body.revision;
    assert.match(revision, /^[0-9a-f]{64}$/);
    response = await callServer(port, '/api/save', {
      method: 'POST', origin: 'https://untrusted.example', body: { tokens: initial, revision },
    });
    assert.equal(response.status, 403);
    const altered = { ...initial, sidebarSlideDurationMs: 390 };
    response = await callServer(port, '/api/preview', {
      method: 'POST', body: { tokens: altered, revision },
    });
    assert.equal(response.status, 200);
    response = await callServer(port, '/api/tokens');
    assert.equal(response.body.sidebarSlideDurationMs, 390);
    assert.equal(readFileSync(savedPath, 'utf8'), storedText, 'Preview must not persist');
    response = await callServer(port, '/api/reset', {
      method: 'POST', body: {},
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.tokens, initial);
    response = await callServer(port, '/api/save', {
      method: 'POST', body: { tokens: initial, revision },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.saved, initial);
    assert.equal(readFileSync(savedPath, 'utf8'), storedText, 'Saving matching defaults is deterministic');
    response = await callServer(port, '/other/path');
    assert.equal(response.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
