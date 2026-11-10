import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedHostCacheKey } from '../src/storage/profile';

test('private data home uses an independent conversation cache namespace per host', () => {
  const oldHostKey = 'test-host-id';
  assert.notEqual(isolatedHostCacheKey(oldHostKey), oldHostKey);
  assert.equal(isolatedHostCacheKey(oldHostKey), isolatedHostCacheKey(oldHostKey));
  assert.notEqual(isolatedHostCacheKey(oldHostKey), isolatedHostCacheKey('other-host'));
  assert.throws(() => isolatedHostCacheKey(''), /required/);
});
