import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSnapshot, applyNotice, parseProjects, parseThreads, parseModels,
  parseQueue, parsePermissions, parseGoal,
} from '../src/nativeProtocol.ts';

test('native projects recognize path objects and preserve host ownership', () => {
  const rows = parseProjects({ data: [{ id: 'p1', name: 'Project', position: 1, roots: [{ path: 'C:\\work' }, 'D:\\other'] }] }, 'noha');
  assert.deepEqual(rows[0].roots, ['C:\\work', 'D:\\other']);
  assert.equal(rows[0].hostId, 'noha');
  assert.throws(() => parseProjects({ bogus: [] }, '6v'), /INVALID_PROJECT_LIST/);
});

test('active and archived histories use distinct native IDs and timestamps', () => {
  const raw = { data: [{ id: 'thread-a', name: 'Example', projectId: 'p1', recencyAt: 1700000000, status: 'running' }] };
  const result = parseThreads(raw, '6v');
  assert.equal(result[0].status, 'running');
  assert.equal(result[0].updatedAt, 1700000000000);
  assert.equal(result[0].project, 'p1');
  assert.equal(parseThreads(raw, 'noha', true)[0].archived, true);
});

test('snapshot exposes canonical text, summary, tools and active turn identity', () => {
  const raw = { thread: { id: 't', turns: [{ id: 'turn', status: 'inProgress', startedAt: 1700000000, items: [
    { id: 'u', type: 'userMessage', content: [{ type: 'text', text: 'question' }] },
    { id: 'r', type: 'reasoning', summary: [{ text: 'safe public summary' }] },
    { id: 'c', type: 'commandExecution', command: 'echo safe', status: 'completed', exitCode: 0 },
    { id: 'a', type: 'agentMessage', text: 'answer' },
  ] }] } };
  const state = parseSnapshot(raw, 't');
  assert.equal(state.running, true);
  assert.equal(state.activeTurnId, 'turn');
  assert.equal(state.messages.length, 4);
  assert.deepEqual(state.messages.map((m) => m.kind ?? m.role), ['user', 'reasoning', 'tool', 'assistant']);
  assert.equal(state.messages[0].id, 'turn:u');
  assert.equal(state.messages[3].complete, false);
  assert.throws(() => parseSnapshot(raw, 'another'), /DIFFERENT_THREAD/);
});

test('native deltas deduplicate by turn/item ID and completed records remain authoritative', () => {
  let messages = applyNotice([], { method: 'item/agentMessage/delta', params: {
    threadId: 't', turnId: 'x', itemId: 'a', delta: 'Hello',
  } });
  messages = applyNotice(messages, { method: 'item/agentMessage/delta', params: {
    threadId: 't', turnId: 'x', itemId: 'a', delta: ' world',
  } });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'Hello world');
  messages = applyNotice(messages, { method: 'item/completed', params: {
    threadId: 't', turnId: 'x', itemId: 'a',
    item: { type: 'agentMessage', id: 'a', text: 'Hello world!' },
  } });
  assert.equal(messages[0].content, 'Hello world!');
  assert.equal(messages[0].complete, true);
  const repeated = applyNotice(messages, { method: 'item/agentMessage/delta', params: {
    threadId: 't', turnId: 'x', itemId: 'a', delta: 'do not append',
  } });
  assert.deepEqual(repeated, messages);
});

test('queued followups, permissions, models and goals reflect native shapes', () => {
  assert.deepEqual(parseQueue({ data: [{ id: 'q', input: [{ type: 'text', text: 'next' }] }] }), [{ id: 'q', text: 'next' }]);
  assert.deepEqual(parsePermissions({ data: [{ id: ':read-only', allowed: true }] })[0].allowed, true);
  assert.deepEqual(parseModels({ data: [{
    id: 'm', displayName: 'Model', isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], defaultReasoningEffort: 'medium',
  }] })[0].efforts, ['medium']);
  assert.equal(parseGoal({ threadId: 't', objective: 'ship web', status: 'active' }, 't')?.objective, 'ship web');
  assert.throws(() => parseGoal({ threadId: 'different', objective: 'no', status: 'active' }, 't'), /INVALID_GOAL/);
});

test('native snapshots retain image-only and image-plus-text messages without exposing host paths', () => {
  const snapshot = parseSnapshot({ thread: { id: 't', turns: [{
    id: 'turn', status: 'completed', items: [
      { id: 'img1', type: 'userMessage', content: [
        { type: 'text', text: '请查看我附带的图片' },
        { type: 'localImage', path: 'C:\\private\\uploads\\first.jpg' },
      ] },
      { id: 'img2', type: 'userMessage', content: [
        { type: 'text', text: '这是第二张' },
        { type: 'localImage', path: 'C:\\private\\uploads\\second.png' },
      ] },
    ],
  }] } }, 't');
  assert.equal(snapshot.messages.length, 2);
  assert.equal(snapshot.messages[0].content, '');
  assert.deepEqual(snapshot.messages[0].images, [{ itemId: 'img1', imageIndex: 0 }]);
  assert.equal(snapshot.messages[1].content, '这是第二张');
  assert.deepEqual(snapshot.messages[1].images, [{ itemId: 'img2', imageIndex: 0 }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /private|uploads|\.jpg|\.png/);
});
