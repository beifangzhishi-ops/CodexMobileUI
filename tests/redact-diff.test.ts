import test from 'node:test';
import assert from 'node:assert/strict';
import { redactNativeDiffFrame } from '../gateway/redactDiff';

test('native fileChange strips diff from live activity notices', () => {
  const original = JSON.stringify({ method: 'item/completed', params: { item: {
    type: 'fileChange', changes: [{ path: 'README.md', kind: 'update', diff: '-secret\n+other' }],
  } } });
  const sanitized = JSON.parse(redactNativeDiffFrame(original));
  assert.deepEqual(sanitized.params.item.changes, [{ path: 'README.md', kind: 'update' }]);
});

test('native thread/read strips fileChange diffs without altering assistant text', () => {
  const original = JSON.stringify({ id: 1, result: { thread: { turns: [{ items: [
    { type: 'fileChange', changes: [{ path: 'a.ts', diff: 'secret' }] },
    { type: 'agentMessage', text: 'Visible reply' },
  ] }] } } });
  const result = JSON.parse(redactNativeDiffFrame(original));
  assert.equal(result.result.thread.turns[0].items[0].changes[0].diff, undefined);
  assert.equal(result.result.thread.turns[0].items[1].text, 'Visible reply');
});
