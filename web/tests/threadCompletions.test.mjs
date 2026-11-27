import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseThreadCompletions, writeCachedThreadCompletions,
} from '../src/threadCompletions.ts';

test('thread completions keep host-scoped identity and reject ambiguous snapshots', () => {
  const valid = { revision: 4, items: [
    { hostId: '6v', threadId: 'thread-1' },
    { hostId: 'noha', threadId: 'thread-1' },
  ] };
  assert.deepEqual(parseThreadCompletions(valid), valid);
  assert.throws(() => parseThreadCompletions({
    revision: 0,
    items: [{ hostId: 'all', threadId: 'thread-1' }],
  }), /INVALID_THREAD_COMPLETIONS/);
  assert.throws(() => parseThreadCompletions({
    revision: 0,
    items: [valid.items[0], valid.items[0]],
  }), /INVALID_THREAD_COMPLETIONS/);
  assert.throws(() => parseThreadCompletions({ revision: -1, items: [] }),
    /INVALID_THREAD_COMPLETIONS/);
});

test('completion browser cache is optional after a server-acknowledged save', () => {
  const snapshot = { revision: 1, items: [{ hostId: '6v', threadId: 'thread-1' }] };
  let stored = '';
  writeCachedThreadCompletions({ setItem: (_key, value) => { stored = value; } }, snapshot);
  assert.deepEqual(JSON.parse(stored), snapshot);
  assert.doesNotThrow(() => writeCachedThreadCompletions({
    setItem: () => { throw new Error('storage unavailable'); },
  }, snapshot));
  assert.doesNotThrow(() => writeCachedThreadCompletions(() => {
    throw new Error('storage access denied');
  }, snapshot));
  assert.doesNotThrow(() => writeCachedThreadCompletions(null, snapshot));
});
