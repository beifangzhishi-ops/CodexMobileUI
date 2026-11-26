import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_THREAD_PREVIEW_LIMIT, visibleProjectThreads,
} from '../src/projectThreadVisibility.ts';

test('project conversations show five by default and preserve native order when expanded', () => {
  const threads = Array.from({ length: 8 }, (_, index) => ({ id: 'thread-' + index }));
  assert.equal(PROJECT_THREAD_PREVIEW_LIMIT, 5);
  assert.deepEqual(visibleProjectThreads(threads, false), threads.slice(0, 5));
  assert.deepEqual(visibleProjectThreads(threads, true), threads);
  assert.deepEqual(visibleProjectThreads(threads.slice(0, 4), false), threads.slice(0, 4));
});
