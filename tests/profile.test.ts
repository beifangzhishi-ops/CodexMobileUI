import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_COORDINATOR_URL, unifiedWebUrl } from '../src/core/unifiedWeb';

test('Android connects exclusively to a private HTTPS Tailnet Coordinator', () => {
  assert.equal(DEFAULT_COORDINATOR_URL, 'https://cpa-node.tail7c23f0.ts.net:4190');
  assert.equal(unifiedWebUrl('https://cpa-node.tail7c23f0.ts.net:4190/'),
    'https://cpa-node.tail7c23f0.ts.net:4190');
  for (const address of [
    'http://100.76.74.124:48889',
    'http://100.76.74.124:4190',
    'https://100.76.74.124:4190',
    'https://cpa-node.tail7c23f0.ts.net:8443',
    'https://cpa-node.tail7c23f0.ts.net:4190/hosts',
    'https://evil.example.com:4190',
  ]) assert.equal(unifiedWebUrl(address), null, address);
});
