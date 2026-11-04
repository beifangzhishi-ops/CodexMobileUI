import test from 'node:test';
import assert from 'node:assert/strict';
import { demoReducer, initialDemoState } from '../src/demo/conversations';

test('starts with exactly three independent seeded test chats', () => {
  assert.deepEqual(initialDemoState.conversations.map((thread) => thread.id), ['test-1', 'test-2', 'test-3']);
  assert.ok(initialDemoState.conversations.every((thread) => thread.messages.length === 0));
});

test('sending arbitrary nonempty input returns only 测试成功', () => {
  let state = demoReducer(initialDemoState, { type: 'draft', text: '  Hello 测试  ' });
  state = demoReducer(state, { type: 'send' });
  const selected = state.conversations.find((thread) => thread.id === state.selectedId)!;
  assert.deepEqual(selected.messages.map((message) => [message.role, message.text]), [
    ['user', 'Hello 测试'], ['assistant', '测试成功'],
  ]);
  assert.equal(selected.draft, '');
  assert.equal(demoReducer(state, { type: 'send' }), state, 'duplicate press must not duplicate messages');
});

test('whitespace-only input is ignored', () => {
  const state = demoReducer(initialDemoState, { type: 'draft', text: '  \n  ' });
  assert.equal(demoReducer(state, { type: 'send' }), state);
});

test('switching chats preserves independent messages and drafts', () => {
  let state = demoReducer(initialDemoState, { type: 'draft', text: '第一条' });
  state = demoReducer(state, { type: 'send' });
  state = demoReducer(state, { type: 'select', id: 'test-2' });
  state = demoReducer(state, { type: 'draft', text: '草稿二' });
  state = demoReducer(state, { type: 'select', id: 'test-1' });
  assert.equal(state.conversations[0].messages.length, 2);
  assert.equal(state.conversations[1].draft, '草稿二');
  assert.equal(state.conversations[1].messages.length, 0);
});

test('new chats are distinct and seed chats remain present', () => {
  let state = demoReducer(initialDemoState, { type: 'new' });
  assert.equal(state.conversations.length, 4);
  assert.equal(state.selectedId, 'local-1');
  state = demoReducer(state, { type: 'draft', text: '新会话标题' });
  state = demoReducer(state, { type: 'send' });
  assert.equal(state.conversations[0].title, '新会话标题');
  state = demoReducer(state, { type: 'new' });
  assert.equal(state.selectedId, 'local-3');
  assert.equal(new Set(state.conversations.map((thread) => thread.id)).size, 5);
  assert.ok(state.conversations.some((thread) => thread.id === 'test-3'));
});
