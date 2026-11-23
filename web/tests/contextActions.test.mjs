import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { contextTargetFromAttributes, gestureMoved, threadLink, threadFromLink,
  readUnreadThreads } from '../src/contextActions.ts';

test('right-click/long-press target identity is bounded', () => {
  assert.deepEqual(contextTargetFromAttributes('thread', 'noha', 'id-1'), { kind: 'thread', hostId: 'noha', id: 'id-1' });
  assert.deepEqual(contextTargetFromAttributes('file', '6v', 'C:\\work\\result.png', 'assistant'),
    { kind: 'file', hostId: '6v', id: 'C:\\work\\result.png', origin: 'assistant' });
  assert.deepEqual(contextTargetFromAttributes('image', '6v', 'blob:http://localhost/example'),
    { kind: 'image', hostId: '6v', id: 'blob:http://localhost/example' });
  assert.equal(contextTargetFromAttributes('host', '6v', 'x'), null);
  assert.equal(contextTargetFromAttributes('thread', 'unknown', 'x'), null);
});
test('scrolling cancels long press, micro movement does not', () => {
  assert.equal(gestureMoved(10, 20, 15, 24), false);
  assert.equal(gestureMoved(10, 20, 10, 34), true);
});
test('private conversation deep links round trip', () => {
  const link = threadLink('http://100.76.74.124:4190/', '6v', 'thread-id');
  assert.deepEqual(threadFromLink(link), { hostId: '6v', id: 'thread-id' });
  assert.equal(threadFromLink('http://host/?host=other&thread=abc'), null);
});
test('unread client settings reject invalid records', () => {
  assert.deepEqual(readUnreadThreads('{"6v:abc":true,"noha:xyz":false,"fake:x":true}'), { '6v:abc': true });
  assert.deepEqual(readUnreadThreads('{malformed'), {});
});
