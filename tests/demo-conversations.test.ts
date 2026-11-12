import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONNECT_PROMPT, demoReducer, initialDemoState, sortConversations, sortProjects,
} from '../src/demo/conversations';

test('visual edition starts with three independent local chats and local projects', () => {
  assert.deepEqual(initialDemoState.conversations.map((thread) => thread.id), ['test-1', 'test-2', 'test-3']);
  assert.ok(initialDemoState.conversations.every((thread) => thread.messages.length === 0));
  assert.ok(initialDemoState.projects.length > 5);
  assert.equal(initialDemoState.selectedHostId, null);
  assert.equal(initialDemoState.hosts.length, 0);
});

test('offline send is pending, then always replies with the exact connect prompt', () => {
  let state = demoReducer(initialDemoState, { type: 'draft', text: '  Hello 测试  ' });
  state = demoReducer(state, { type: 'send' });
  assert.equal(state.conversations[0].running, true);
  assert.deepEqual(state.conversations[0].messages.map((message) => message.text), ['Hello 测试']);
  assert.equal(demoReducer(state, { type: 'send' }), state, 'duplicate press must not send twice');
  state = demoReducer(state, { type: 'reply', id: state.selectedId, visible: true });
  assert.equal(state.conversations[0].running, false);
  assert.equal(state.conversations[0].unread, false);
  assert.deepEqual(state.conversations[0].messages.map((message) => message.text), ['Hello 测试', CONNECT_PROMPT]);
});

test('blank messages cannot be sent', () => {
  const state = demoReducer(initialDemoState, { type: 'draft', text: '  \n  ' });
  assert.equal(demoReducer(state, { type: 'send' }), state);
});

test('independent drafts, last messages, and unread state survive thread switches', () => {
  let state = demoReducer(initialDemoState, { type: 'draft', text: '第一条' });
  state = demoReducer(state, { type: 'send' });
  const inProgressId = state.selectedId;
  state = demoReducer(state, { type: 'select', id: 'test-2' });
  state = demoReducer(state, { type: 'draft', text: '草稿' });
  state = demoReducer(state, { type: 'reply', id: inProgressId, visible: false });
  assert.equal(state.conversations[0].unread, true);
  state = demoReducer(state, { type: 'select', id: 'test-1' });
  assert.equal(state.conversations[0].unread, false);
  assert.equal(state.conversations[0].messages.length, 2);
  assert.equal(state.conversations[1].draft, '草稿');
});

test('new project conversations are independent and linked by stable project ID', () => {
  let state = demoReducer(initialDemoState, { type: 'new', projectId: 'project-1' });
  assert.equal(state.conversations.length, 4);
  assert.equal(state.selectedId, 'local-1');
  assert.equal(state.conversations[0].projectId, 'project-1');
  state = demoReducer(state, { type: 'draft', text: '项目消息' });
  state = demoReducer(state, { type: 'send' });
  assert.equal(state.conversations[0].title, '项目消息');
  state = demoReducer(state, { type: 'new' });
  assert.equal(state.conversations[0].projectId, null);
  assert.equal(new Set(state.conversations.map((thread) => thread.id)).size, 5);
});

test('removing a project retains all its conversations as ordinary chats', () => {
  const state = demoReducer(initialDemoState, { type: 'project-delete', id: 'project-1' });
  assert.equal(state.projects.some((project) => project.id === 'project-1'), false);
  assert.equal(state.conversations[0].projectId, null);
  assert.equal(state.conversations.length, 3);
});

test('hosts can be selected, renamed and removed with no fake connected fallback', () => {
  let state = demoReducer(initialDemoState, { type: 'host-add', name: '演示电脑 1' });
  const id = state.hosts[0].id;
  assert.equal(state.selectedHostId, id);
  state = demoReducer(state, { type: 'host-rename', id, name: '已重命名' });
  assert.equal(state.hosts[0].name, '已重命名');
  state = demoReducer(state, { type: 'host-remove', id });
  assert.equal(state.hosts.length, 0);
  assert.equal(state.selectedHostId, null);
});

test('new chat assigns a local machine and project independently of other chats', () => {
  let state = demoReducer(initialDemoState, { type: 'host-add', name: '测试机器' });
  const hostId = state.selectedHostId;
  assert.ok(hostId);
  state = demoReducer(state, { type: 'new', projectId: 'project-2' });
  const id = state.selectedId;
  assert.equal(state.conversations[0].hostId, hostId);
  assert.equal(state.conversations[0].projectId, 'project-2');
  state = demoReducer(state, { type: 'conversation-project', id, projectId: 'project-3' });
  assert.equal(state.conversations[0].projectId, 'project-3');
  state = demoReducer(state, { type: 'conversation-host', id, hostId: null });
  assert.equal(state.conversations[0].hostId, null);
  state = demoReducer(state, { type: 'host-add-for-conversation', id, name: '第二台测试机器' });
  assert.equal(state.hosts.length, 2);
  assert.equal(state.conversations[0].hostId, state.selectedHostId);
  assert.equal(state.conversations[1].projectId, 'project-1', 'other chats retain their existing project');
  state = demoReducer(state, { type: 'conversation-project', id, projectId: 'unknown' });
  assert.equal(state.conversations[0].projectId, null, 'unknown project cannot be assigned');
});

test('pin, remove-from-project, archive, restore and delete affect only the chosen local chat', () => {
  let state = demoReducer(initialDemoState, { type: 'conversation-pin', id: 'test-1' });
  assert.equal(state.conversations[0].pinned, true);
  state = demoReducer(state, { type: 'conversation-remove-project', id: 'test-1' });
  assert.equal(state.conversations[0].projectId, null);
  state = demoReducer(state, { type: 'conversation-archive', id: 'test-1' });
  assert.equal(state.conversations[0].archived, true);
  assert.notEqual(state.selectedId, 'test-1', 'archived active chat gives way to visible chat');
  assert.equal(state.conversations.length, 3, 'archiving is not deletion');
  state = demoReducer(state, { type: 'select', id: 'test-1' });
  state = demoReducer(state, { type: 'conversation-archive', id: 'test-1' });
  assert.equal(state.conversations[0].archived, false);
  state = demoReducer(state, { type: 'conversation-delete', id: 'test-1' });
  assert.equal(state.conversations.some((c) => c.id === 'test-1'), false);
  assert.equal(state.conversations.length, 2);
});

test('project and recent conversation views share the same IDs and sorted order', () => {
  let state = demoReducer(initialDemoState, { type: 'conversation-pin', id: 'test-3' });
  state = demoReducer(state, { type: 'project-pin', id: 'project-2' });
  assert.equal(sortConversations(state.conversations)[0].id, 'test-3');
  assert.equal(sortProjects(state.projects)[0].id, 'project-2');
  assert.equal(state.conversations.filter((c) => c.projectId === 'project-1')[0].id, 'test-1');
  state = demoReducer(state, { type: 'include-project-conversations', value: false });
  const recent = sortConversations(state.conversations)
    .filter((c) => state.includeProjectConversations || c.projectId === null);
  assert.equal(recent.some((c) => c.projectId), false);
});

test('a project becomes recent when its child chat receives a new message', () => {
  let state = demoReducer(initialDemoState, { type: 'draft', text: '刷新项目时间' });
  state = demoReducer(state, { type: 'send' });
  assert.equal(sortProjects(state.projects)[0].id, 'project-1');
});

test('restoring an interrupted local reply does not leave a permanently running chat', () => {
  let state = demoReducer(initialDemoState, { type: 'draft', text: '尚未回复' });
  state = demoReducer(state, { type: 'send' });
  assert.equal(state.conversations[0].running, true);
  state = demoReducer(initialDemoState, { type: 'hydrate', state });
  assert.equal(state.conversations[0].running, false);
  assert.equal(state.conversations[0].unread, true);
  assert.equal(state.conversations[0].messages.at(-1)?.text, CONNECT_PROMPT);
});
