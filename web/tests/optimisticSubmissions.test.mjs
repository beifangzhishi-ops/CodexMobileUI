import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addOptimisticSubmission, visibleOptimisticSubmissions, reconcileOptimisticAfterRead,
} from '../src/optimisticSubmissions.ts';

const key = 'thread:6v:t';
const user = (id, content, turnId = 'turn', imageCount = 0) => ({
  id, role: 'user', turnId, content,
  ...(imageCount ? { images: Array.from({ length: imageCount }, (_, imageIndex) =>
    ({ itemId: id, imageIndex })) } : {}),
});
const draft = (id, content, imageCount = 0, at = key) => ({
  id, hostId: '6v', key: at, text: content, submittedText: content, imageCount,
});

test('one web local bubble is replaced by the native item without a timestamp', () => {
  const [local] = addOptimisticSubmission([], draft('local', 'hello'), []);
  assert.equal(local.status, 'sending');
  assert.equal(visibleOptimisticSubmissions([local], key, []).length, 1);
  assert.deepEqual(visibleOptimisticSubmissions([local], key, [user('turn:server', 'hello')]), []);
});

test('first-send promotion keeps the bubble during pending-thread navigation', () => {
  const pendingKey = 'new:6v:none';
  const [local] = addOptimisticSubmission([], draft('first', 'hello', 0, pendingKey), []);
  const promoted = [{ ...local, key, originKey: pendingKey, status: 'accepted', turnId: 'turn' }];
  assert.equal(visibleOptimisticSubmissions(promoted, pendingKey, []).length, 1);
  assert.equal(visibleOptimisticSubmissions(promoted, key, []).length, 1);
  assert.deepEqual(visibleOptimisticSubmissions(promoted, key, [user('turn:u', 'hello')]), []);
});

test('repeated identical user text consumes one optimistic bubble per native item', () => {
  const first = addOptimisticSubmission([], draft('one', 'continue'), []);
  const second = addOptimisticSubmission(first, draft('two', 'continue'), []);
  assert.deepEqual(second.map((item) => item.expectedMatchCount), [1, 2]);
  assert.deepEqual(visibleOptimisticSubmissions(second, key,
    [user('turn-1:u', 'continue')]).map((item) => item.id), ['two']);
  assert.deepEqual(visibleOptimisticSubmissions(second, key,
    [user('turn-1:u', 'continue'), user('turn-2:u', 'continue')]), []);
});

test('old same-text history does not hide a newly submitted message', () => {
  const oldHistory = [user('old:u', 'repeat', 'old')];
  const local = addOptimisticSubmission([], draft('new', 'repeat'), oldHistory);
  assert.equal(local[0].expectedMatchCount, 2);
  assert.equal(visibleOptimisticSubmissions(local, key, oldHistory).length, 1);
  assert.equal(visibleOptimisticSubmissions(local, key,
    [...oldHistory, user('new:u', 'repeat', 'new')]).length, 0);
});

test('steered user items with a shared turn ID reconcile by occurrence', () => {
  const existing = [user('first', 'start', 'active')];
  const first = addOptimisticSubmission([], draft('a', 'repeat'), existing);
  const second = addOptimisticSubmission(first, draft('b', 'repeat'), existing);
  const accepted = second.map((item) => ({ ...item, status: 'accepted', turnId: 'active', steered: true }));
  assert.deepEqual(visibleOptimisticSubmissions(accepted, key,
    [...existing, user('steer-1', 'repeat', 'active')]).map((item) => item.id), ['b']);
  assert.deepEqual(visibleOptimisticSubmissions(accepted, key,
    [...existing, user('steer-1', 'repeat', 'active'), user('steer-2', 'repeat', 'active')]), []);
});

test('non-steered native turn reconciles even if native text differs', () => {
  const accepted = addOptimisticSubmission([], draft('local', 'with mentions'), [])
    .map((item) => ({ ...item, turnId: 'new-turn', status: 'accepted' }));
  assert.deepEqual(visibleOptimisticSubmissions(accepted, key,
    [user('new-turn:u', 'text after native normalization', 'new-turn')]), []);
});

test('image-only and image-plus-text submissions match by native image count', () => {
  const local = addOptimisticSubmission([], draft('photo', '', 2), []);
  assert.equal(visibleOptimisticSubmissions(local, key, [user('old', '', 'old', 1)]).length, 1);
  assert.equal(visibleOptimisticSubmissions(local, key, [user('actual', '', 'new', 2)]).length, 0);
  const mixed = addOptimisticSubmission([], draft('mixed', 'caption', 1), []);
  assert.equal(visibleOptimisticSubmissions(mixed, key, [user('plain', 'caption')]).length, 1);
  assert.equal(visibleOptimisticSubmissions(mixed, key, [user('with-photo', 'caption', 'new', 1)]).length, 0);
});

test('document-only optimistic bubble reconciles with native Desktop file references', () => {
  const [pending] = addOptimisticSubmission([], { ...draft('doc', ''), fileCount: 1 }, []);
  assert.equal(visibleOptimisticSubmissions([pending], key, []).length, 1);
  const userWithFile = {
    id: 'file:u', role: 'user', turnId: 'file-turn', content: '',
    files: [{ itemId: 'file:u', fileIndex: 0, name: 'notes.md', path: 'C:\\file.md' }],
  };
  assert.deepEqual(visibleOptimisticSubmissions([pending], key, [userWithFile]), []);
  assert.equal(visibleOptimisticSubmissions([pending], key, [user('text-only', '')]).length, 1);
});

test('native refresh clears settled ghosts without touching in-flight or other hosts', () => {
  const settled = addOptimisticSubmission([], draft('accepted', 'hello'), [])
    .map((item) => ({ ...item, status: 'accepted' }));
  const other = addOptimisticSubmission(settled, draft('other', 'noha', 0, 'thread:noha:x'), []);
  const pending = addOptimisticSubmission(other, draft('pending', 'in flight'), []);
  assert.deepEqual(reconcileOptimisticAfterRead(pending, key, [])
    .map((item) => item.id), ['other', 'pending']);
  assert.deepEqual(reconcileOptimisticAfterRead(pending, key,
    [user('received', 'in flight')]).map((item) => item.id), ['other']);
});
