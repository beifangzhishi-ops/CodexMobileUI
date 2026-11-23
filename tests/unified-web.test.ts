import test from 'node:test';
import assert from 'node:assert/strict';
import { unifiedWebUrl } from '../src/core/unifiedWeb';

test('shared UI accepts the private HTTPS coordinator', () => {
  assert.equal(unifiedWebUrl('https://node.example.ts.net:4190'),
    'https://node.example.ts.net:4190');
  assert.equal(unifiedWebUrl('https://node.example.ts.net:4190/'),
    'https://node.example.ts.net:4190');
});

test('shared UI never opens an arbitrary or public address from a host entry', () => {
  for (const value of [null, '', 'http://localhost:48889',
    'http://8.8.8.8:48889', 'https://100.76.74.124:48889',
    'http://100.76.74.124:4190', 'http://100.76.74.124:48889',
    'https://node.example.ts.net', 'https://node.example.ts.net:4190/public', 'http://100.76.74.124:48889/else',
    'http://me:secret@100.76.74.124:48889',
    'http://100.76.74.124:48889/?redirect=https://example.com',
    'http://100.76.74.124:48889/#unsafe', 'not a url',
    'http://100.128.0.1:48889']) {
    assert.equal(unifiedWebUrl(value), null, String(value));
  }
});
