import test from 'node:test';
import assert from 'node:assert/strict';
import { workspacePath, validateWorkspaceMetadata } from '../gateway/workspace';

test('standalone directories derive from fixed host-owned root and timestamp ID', () => {
  const draftId = Date.now() + '-0123456789abcdef01234567';
  const path = workspacePath(draftId, 'C:\\Users\\Example');
  assert.ok(path.includes('Codex'));
  assert.ok(path.includes('MobileUI'));
  assert.ok(path.endsWith(draftId));
  assert.ok(path.startsWith('C:\\Users\\Example'));
  assert.equal(workspacePath(draftId, 'C:\\Users\\Example'), path);
});

test('standalone directory guard refuses arbitrary paths and IDs', () => {
  for (const candidate of ['../other', 'C:\\Windows', '', '1760000000000-..', null]) {
    assert.throws(() => workspacePath(candidate), /无效/);
  }
  assert.equal(validateWorkspaceMetadata({ isDirectory: true, isSymlink: false }), true);
  assert.equal(validateWorkspaceMetadata({ isDirectory: true, isSymlink: true }), false);
  assert.equal(validateWorkspaceMetadata({ isDirectory: false, isSymlink: false }), false);
});
