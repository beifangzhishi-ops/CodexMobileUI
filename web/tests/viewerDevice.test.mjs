import test from 'node:test';
import assert from 'node:assert/strict';
import { MOBILE_VIEWER, resolveViewerDevice } from '../src/viewerDevice.ts';
import { pathForViewer, defaultPathHosts } from '../src/pathHosts.ts';

test('viewer identity is a local preference defaulting to the primary host', () => {
  const hosts = ['6v', 'noha'];
  assert.equal(resolveViewerDevice(null, hosts, false), '6v');
  assert.equal(resolveViewerDevice('noha', hosts, false), 'noha');
  assert.equal(resolveViewerDevice('unknown', hosts, false), '6v');
  assert.equal(resolveViewerDevice(MOBILE_VIEWER, hosts, false), MOBILE_VIEWER);
  assert.equal(resolveViewerDevice('noha', hosts, true), MOBILE_VIEWER);
  assert.equal(resolveViewerDevice(null, [], false), '6v');
  const path = 'C:\\example.txt';
  assert.equal(pathForViewer(path, 'noha', null, defaultPathHosts), path);
});
