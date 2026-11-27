import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webContentSecurityPolicy } from '../server/securityPolicy.mjs';

test('tailnet web permits HTTPS logo images and exact browser WebSocket endpoint', () => {
  const policy = webContentSecurityPolicy('http://100.76.74.124:4190');
  assert.match(policy, /img-src 'self' blob: data: https:/);
  assert.match(policy, /connect-src 'self' ws:\/\/100\.76\.74\.124:4190/);
  assert.doesNotMatch(policy, /http:\/\/127\.0\.0\.1:419[01]/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /frame-src 'self'/);
  assert.match(policy, /media-src 'self' blob:/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /script-src[^;]*https:/);
  assert.doesNotMatch(policy, /connect-src[^;]*https:/);
});

test('HTTPS configuration uses WSS while malformed origins fail closed', () => {
  assert.match(webContentSecurityPolicy('https://example.test:443'),
    /connect-src 'self' wss:\/\/example\.test/);
  for (const value of ['file:///tmp/index.html', 'https://user@example.test',
    'http://example.test/unexpected-path', 'http://example.test?other=true']) {
    assert.throws(() => webContentSecurityPolicy(value), /INVALID_WEB_ORIGIN/);
  }
});

test('private web agent does not require the coordinator browser origin', () => {
  const source = readFileSync(new URL('../server/bridge.mjs', import.meta.url), 'utf8');
  assert.match(source, /contentSecurityPolicy = coordinator \? webContentSecurityPolicy\(config\.origin\) : null/);
});
