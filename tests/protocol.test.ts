import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNotification, extractMessages, normalizeThread, parseThreadList, parseThreadSnapshot,
} from '../src/core/protocol';

test('normalize threads without inventing a project or name', () => {
  const threads = parseThreadList({ data: [
    { id: 'thr-1', name: 'Chapter 3', cwd: 'C:\\Project\\Thesis', recencyAt: 42 },
    { id: 'thr-2', name: null, cwd: null, recencyAt: 22 },
    { bad: 'no id' },
  ] });
  assert.equal(threads.length, 2);
  assert.deepEqual(threads[0], {
    id: 'thr-1', name: 'Chapter 3', cwd: 'C:\\Project\\Thesis', updatedAt: 42,
  });
  assert.equal(normalizeThread({ name: 'missing id' }), null);
  assert.equal(threads[1].cwd, null);
});

test('extract original Codex message ids and message ordering', () => {
  const turns = [
    { id: 't1', items: [
      { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '你好' }] },
      { id: 'shell1', type: 'commandExecution', command: 'pwd' },
      { id: 'a1', type: 'agentMessage', text: '这是 **回答**' },
    ] },
    { id: 't2', items: [
      { id: 'u2', type: 'userMessage', content: [{ type: 'text', text: '继续' }] },
    ] },
  ];
  const messages = extractMessages('thread', turns);
  assert.deepEqual(messages.map((m) => m.id), ['t1:u1', 't1:a1', 't2:u2']);
  assert.deepEqual(messages.map((m) => m.ordinal), [0, 2, 100000]);
  assert.deepEqual(parseThreadSnapshot({ thread: { id: 'thread', turns } }, 'bad'), messages);
});

test('delta streaming and completed item use stable ids and never duplicate', () => {
  let messages = applyNotification([], {
    method: 'item/agentMessage/delta',
    params: { threadId: 'th', turnId: 't1', itemId: 'a1', delta: 'Hel' },
  }, 'th');
  messages = applyNotification(messages, {
    method: 'item/agentMessage/delta',
    params: { threadId: 'th', turnId: 't1', itemId: 'a1', delta: 'lo' },
  }, 'th');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'Hello');
  messages = applyNotification(messages, {
    method: 'item/completed',
    params: { threadId: 'th', turnId: 't1', itemId: 'a1', item: { type: 'agentMessage', text: 'Hello!' } },
  }, 'th');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'Hello!');
  assert.equal(applyNotification(messages, {
    method: 'item/agentMessage/delta',
    params: { threadId: 'elsewhere', turnId: 't1', itemId: 'a1', delta: 'ignore' },
  }, 'th')[0].text, 'Hello!');
});
