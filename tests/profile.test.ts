import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHost, isTailnetHost, websocketUrl } from '../src/core/host';

test('mobile accepts only private Tailscale Gateway addresses', () => {
  const host = parseHost('http://100.76.74.124:48889');
  assert.equal(host.baseUrl, 'http://100.76.74.124:48889');
  assert.equal(isTailnetHost(host), true);
  assert.equal(websocketUrl(host), 'ws://100.76.74.124:48889/connect');
  assert.equal(websocketUrl({ ...host, id: host.id + '/machines/noha' }),
    'ws://100.76.74.124:48889/connect?host=noha');
  for (const rejected of [
    'https://cpa-node.tail7c23f0.ts.net:8443',
    'http://100.76.74.124:48888',
    'http://192.168.1.10:48889',
    'http://100.76.74.124:48889/oauth',
    'http://100.76.74.124:48889?token=a',
    'http://100.76.74.124:48889@evil.test',
  ]) assert.throws(() => parseHost(rejected), rejected);
});
