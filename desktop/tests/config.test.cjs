'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultSettings, parseSettings, isPrivateIPv4, normalizeServerUrl, fileCandidates } = require('../config.cjs');

test('6v and noha use the same private Coordinator; local path ownership changes', () => {
  const local = defaultSettings('DESKTOP-KFL6V1F');
  const remote = defaultSettings('noha');
  assert.equal(local.localHost, '6v');
  assert.equal(remote.localHost, 'noha');
  assert.equal(local.serverUrl, remote.serverUrl);
  assert.deepEqual(fileCandidates(local, '6v', 'C:/Users/Songjx/test.txt'), ['C:\\Users\\Songjx\\test.txt']);
  assert.deepEqual(fileCandidates(remote, 'noha', 'D:\\data\\test.txt'), ['D:\\data\\test.txt']);
});

test('remote C path prefers configured full-drive share, then administrative fallback', () => {
  const s = defaultSettings('6v');
  assert.deepEqual(fileCandidates(s, 'noha', 'C:\\Users\\noha\\report.pdf'), [
    '\\\\100.96.30.32\\noha\\Users\\noha\\report.pdf',
    '\\\\100.96.30.32\\C$\\Users\\noha\\report.pdf',
  ]);
  assert.deepEqual(fileCandidates(s, 'noha', 'D:\\media\\image.png'), [
    '\\\\100.96.30.32\\D$\\media\\image.png',
  ]);
});

test('no arbitrary network or shell paths are permitted', () => {
  const s = defaultSettings('6v');
  for (const bad of ['\\\\server\\share\\file', 'file:///C:/secret', 'C:relative', 'C:\\foo\nbar',
    'C:\\foo\0bar', '', null, 'C:\\x'.repeat(800)]) {
    assert.throws(() => fileCandidates(s, 'noha', bad));
  }
  assert.throws(() => fileCandidates(s, 'unknown', 'C:\\valid'));
});

test('Coordinator and host IPs must remain on a private network', () => {
  for (const ip of ['100.76.74.124', '127.0.0.1', '10.5.4.3', '172.20.1.3', '192.168.1.2']) {
    assert.equal(isPrivateIPv4(ip), true);
  }
  for (const ip of ['8.8.8.8', '100.128.0.1', '172.32.0.1', '256.0.1.2', 'example.org']) {
    assert.equal(isPrivateIPv4(ip), false);
  }
  assert.equal(normalizeServerUrl('http://100.76.74.124:4190/'), 'http://100.76.74.124:4190/');
  for (const value of ['http://example.com/', 'http://8.8.8.8/', 'file:///C:/test',
    'http://127.0.0.1:4190/path', 'http://u:p@100.76.74.124:4190/',
    'http://100.76.74.124:4190/?query=1', 'javascript:alert(1)']) {
    assert.throws(() => normalizeServerUrl(value));
  }
});

test('validated settings are bounded and include preserved desktop window geometry', () => {
  const s = parseSettings({
    serverUrl: 'http://192.168.1.42:4190/', localHost: 'noha',
    hostIps: { '6v': '100.76.74.124', noha: '100.96.30.32' },
    hostShares: { '6v': '6v1f', noha: 'noha' },
    windowBounds: { x: 80, y: 50, width: 1380, height: 920 },
  }, '6v');
  assert.equal(s.localHost, 'noha');
  assert.equal(s.serverUrl, 'http://192.168.1.42:4190/');
  assert.equal(s.windowBounds.width, 1380);
  assert.throws(() => parseSettings({ hostShares: { noha: '..\\evil' } }, '6v'));
  assert.throws(() => parseSettings({ hostIps: { noha: '8.8.8.8' } }, '6v'));
});
