import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSnapshot, applyNotice, parseProjects, parseThreads, parseModels,
  parseQueue, parsePermissions, parseGoal, displayUserText,
} from '../src/nativeProtocol.ts';
import { renderableLocalFileLinks } from '../../shared/localFileLinks.ts';

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

test('Web and mobile use native formal title then first user-message preview', () => {
  const longTitle = '中'.repeat(61);
  const threads = parseThreads({ data: [
    { id: 'web-unnamed', name: null, preview: '请检查网页和手机的标题' },
    { id: 'web-renamed', name: longTitle, preview: '旧预览' },
    { id: 'empty', name: null, preview: null },
    { id: 'limit', preview: '字'.repeat(60) },
    { id: 'long', preview: '😀'.repeat(61) },
    { id: 'attachment-only', preview: '# Files mentioned by the user:\n\n## note.txt: C:\\note.txt' },
  ] }, '6v');
  assert.deepEqual(threads.map((t) => t.title),
    ['请检查网页和手机的标题', longTitle, '新对话', '字'.repeat(60), '😀'.repeat(59) + '…', '新对话']);
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
  assert.equal(state.messages[3].turnStatus, 'inProgress');
  assert.throws(() => parseSnapshot(raw, 'another'), /DIFFERENT_THREAD/);
});

test('plugin ownership survives native tool conversion without guessing identity', () => {
  const state = parseSnapshot({ thread: { id: 'thread', turns: [{
    id: 'turn', status: 'completed', items: [
      { id: 'tool', type: 'mcpToolCall', server: 'github', tool: 'search',
        pluginId: 'plugin-abc', appContext: { appId: 'app-abc' } },
    ],
  }] } }, 'thread');
  const item = state.messages[0];
  assert.equal(item.pluginId, 'plugin-abc');
  assert.equal(item.appId, 'app-abc');
  assert.equal(item.toolServer, 'github');
  assert.equal(item.toolName, 'search');
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
  const interrupted = applyNotice(repeated, { method: 'turn/completed', params: {
    threadId: 't', turnId: 'x', turn: { id: 'x', status: 'interrupted' },
  } });
  assert.equal(interrupted[0].turnStatus, 'interrupted');
  assert.equal(interrupted[0].complete, true);
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

test('desktop file-reference envelope becomes file tiles with original request text', () => {
  const raw = '# Files mentioned by the user:\n\n' +
    '## report.txt: C:\\uploads\\file123.txt\n\n' +
    '## notes.md: D:\\uploads\\file456.md\n\n' +
    '## My request for Codex:\n\nSummarize these';
  const displayed = displayUserText(raw);
  assert.equal(displayed.content, 'Summarize these');
  assert.deepEqual(displayed.files.map((f) => f.name), ['report.txt', 'notes.md']);
  const parsed = parseSnapshot({ thread: { id: 't', turns: [{
    id: 'turn', status: 'completed', items: [{
      id: 'u', type: 'userMessage', content: [{ type: 'text', text: raw }],
    }],
  }] } }, 't');
  assert.equal(parsed.messages[0].content, 'Summarize these');
  assert.deepEqual(parsed.messages[0].files, [
    { itemId: 'u', fileIndex: 0, name: 'report.txt', path: 'C:\\uploads\\file123.txt' },
    { itemId: 'u', fileIndex: 1, name: 'notes.md', path: 'D:\\uploads\\file456.md' },
  ]);
  assert.equal(displayUserText('Plain C:\\docs\\note.txt').content, 'Plain C:\\docs\\note.txt');
  const uncFile = '# Files mentioned by the user:\n\n## report.pdf: ' +
    '\\\\100.96.30.32\\noha\\Users\\noha\\report.pdf' +
    '\n\n## My request for Codex:\n\n请分析文件';
  assert.equal(displayUserText(uncFile).content, '请分析文件');
  assert.equal(displayUserText(uncFile).files[0].path,
    '\\\\100.96.30.32\\noha\\Users\\noha\\report.pdf');
  assert.deepEqual(displayUserText('# Files mentioned by the user:\n\ninvalid').files, []);
});

test('assistant local Markdown links retain the original host absolute path', () => {
  const projected = renderableLocalFileLinks('[查看报告](file:///D:/Projects/report.pdf)');
  assert.deepEqual(Object.values(projected.targets).map(({ path }) => path), ['D:\\Projects\\report.pdf']);
  assert.equal(Object.keys(projected.targets).length, 1);
  assert.equal(renderableLocalFileLinks('普通内容 D:\\Projects\\report.pdf').markdown,
    '普通内容 D:\\Projects\\report.pdf');
});

test('native image-only messages never introduce invented text', () => {
  const parsed = parseSnapshot({ thread: { id: 't', turns: [{
    id: 'turn', status: 'completed', items: [{ id: 'u', type: 'userMessage',
      content: [{ type: 'text', text: '' }, { type: 'localImage', path: 'C:\\test\\pic.png' }] }],
  }] } }, 't');
  assert.equal(parsed.messages[0].content, '');
  assert.deepEqual(parsed.messages[0].images, [{ itemId: 'u', imageIndex: 0 }]);
});
