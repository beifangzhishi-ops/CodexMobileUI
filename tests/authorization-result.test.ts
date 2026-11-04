import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthorizedCode } from '../src/auth/authorizationResult';

test('mobile OAuth accepts only a matching browser callback and code', () => {
  assert.equal(getAuthorizedCode({
    type: 'success', params: { code: 'single-use-code', state: 'expected' },
  }, 'expected'), 'single-use-code');
  assert.throws(() => getAuthorizedCode({
    type: 'success', params: { code: 'single-use-code', state: 'other' },
  }, 'expected'), /回跳参数不匹配/);
  assert.throws(() => getAuthorizedCode({
    type: 'success', params: { state: 'expected' },
  }, 'expected'), /回跳参数不匹配/);
  assert.equal(getAuthorizedCode({ type: 'cancel' }, 'expected'), null);
  assert.equal(getAuthorizedCode({ type: 'dismiss' }, 'expected'), null);
  assert.equal(getAuthorizedCode({ type: 'error' }, 'expected'), null);
});
