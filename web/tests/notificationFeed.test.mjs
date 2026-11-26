import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { NotificationFeed, notificationContentFromRead, validCursor } from '../server/notificationFeed.mjs';

const THREAD = '12345678-1234-1234-1234-123456789abc';
const TURN = 'abcdef12-1234-1234-1234-123456789abc';
const CHILD_THREAD = '22345678-1234-1234-1234-123456789abc';
const SIDE_THREAD = '32345678-1234-1234-1234-123456789abc';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'codex-notices-'));
  const path = join(root, 'notice-events.json');
  return { path, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function socket() {
  const client = new EventEmitter();
  client.readyState = WebSocket.OPEN;
  client.sent = [];
  client.send = (frame) => client.sent.push(JSON.parse(frame));
  client.close = () => client.emit('close');
  client.subscribe = (after) => client.emit('message',
    Buffer.from(JSON.stringify({ type: 'subscribe', after })), false);
  return client;
}

test('persist only a bounded final assistant preview, never arbitrary event text', async () => {
  const f = fixture();
  try {
    const feed = new NotificationFeed(f.path);
    const params = { threadId: THREAD, turn: { id: TURN, status: 'completed' },
      assistantMessage: 'private answer must not be logged' };
    const snapshot = { thread: {
      name: ' 修复项目 ', turns: [
        { id: 'old-turn-1234', items: [{ type: 'agentMessage', text: 'older reply' }] },
        { id: TURN, items: [
          { type: 'reasoning', text: 'internal thought, never notify' },
          { type: 'commandExecution', output: 'tool output, never notify' },
          { type: 'agentMessage', phase: 'commentary', text: 'working on it' },
          { type: 'agentMessage', phase: 'final_answer', text: '已修复 **完成**，可以继续使用。' },
        ] },
      ],
    } };
    await Promise.all([
      feed.observe('6v', params, async () => snapshot),
      feed.observe('6v', params, async () => snapshot),
    ]);
    assert.equal(feed.events.length, 1);
    assert.equal(feed.events[0].title, '修复项目');
    assert.equal(feed.events[0].preview, '已修复 完成，可以继续使用。');
    const stored = readFileSync(f.path, 'utf8');
    for (const forbidden of ['private answer', 'older reply', 'internal thought',
      'tool output', 'working on it']) assert.ok(!stored.includes(forbidden));
    const restored = new NotificationFeed(f.path);
    await restored.observe('6v', params);
    assert.equal(restored.events.length, 1);
    assert.equal(restored.sequence, 1);
    assert.equal(restored.events[0].preview, '已修复 完成，可以继续使用。');
    await restored.observe('noha', { threadId: THREAD, turn: { id: TURN, status: 'failed' } });
    assert.equal(restored.events[1].status, 'failed');
  } finally { f.cleanup(); }
});

test('a completed turn never picks up text from the previous turn', () => {
  const result = notificationContentFromRead({ thread: { name: '第二轮', turns: [
    { id: 'older-turn', items: [{ type: 'agentMessage', text: 'wrong previous answer' }] },
    { id: TURN, items: [
      { type: 'reasoning', text: 'not a final reply' },
      { type: 'agentMessage', phase: 'commentary', text: 'working, not final' },
    ] },
  ] } }, TURN, { id: TURN });
  assert.equal(result.title, '第二轮');
  assert.equal(result.preview, '');
});

test('unnamed conversation uses user preview and only the last assistant answer', () => {
  const result = notificationContentFromRead({ thread: { preview: ' 请修改通知格式 ',
    turns: [{ id: TURN, items: [
      { type: 'agentMessage', text: 'initial' },
      { type: 'agentMessage', text: '最新回复\n[查看详情](https://example.invalid/test)' },
    ] }],
  } }, TURN);
  assert.equal(result.title, '请修改通知格式');
  assert.equal(result.preview, '最新回复 查看详情');
});

test('completed event items can fill a racing thread/read, and previews are bounded', () => {
  const event = { id: TURN, items: [{ type: 'agentMessage', text: '结果'.repeat(1000) }] };
  const result = notificationContentFromRead({ thread: { name: '一个新任务',
    turns: [{ id: 'old-turn', items: [] }],
  } }, TURN, event);
  assert.equal(result.title, '一个新任务');
  assert.equal([...result.preview].length, 360);
  assert.equal(result.preview, '结果'.repeat(180));
});

test('native sub-agent completions stay silent while ordinary and attached side chats notify', async () => {
  const f = fixture();
  try {
    const feed = new NotificationFeed(f.path);
    const childTurn = 'bbbbbbbb-1234-1234-1234-123456789abc';
    const sourceOnlyChildTurn = 'cccccccc-1234-1234-1234-123456789abc';
    const classificationChildTurn = 'abbbbbbb-1234-1234-1234-123456789abc';
    const sideTurn = 'dddddddd-1234-1234-1234-123456789abc';
    const ordinaryTurn = 'eeeeeeee-1234-1234-1234-123456789abc';
    const snapshots = new Map([
      [CHILD_THREAD, { thread: {
        id: CHILD_THREAD, parentThreadId: THREAD, forkedFromId: null,
        source: 'appServer', threadSource: null, name: '子任务',
      } }],
      [SIDE_THREAD, { thread: {
        id: SIDE_THREAD, parentThreadId: null, forkedFromId: THREAD,
        source: 'appServer', threadSource: null, name: '侧边对话',
      } }],
      [THREAD, { thread: {
        id: THREAD, parentThreadId: null, forkedFromId: null,
        source: 'appServer', threadSource: null, name: '主对话',
      } }],
    ]);
    const resolveThread = async (_hostId, threadId) => snapshots.get(threadId) ?? null;
    const client = socket();
    feed.subscribe(client);
    client.subscribe(0);

    await feed.observe('6v', { threadId: CHILD_THREAD, turn: { id: childTurn } }, resolveThread);
    await feed.observe('6v', { threadId: CHILD_THREAD, turn: { id: sourceOnlyChildTurn } },
      async () => ({ thread: {
        id: CHILD_THREAD, parentThreadId: null, forkedFromId: null,
        source: { subAgent: 'review' }, threadSource: 'subAgentReview', name: '独立子任务',
      } }));
    await feed.observe('6v', { threadId: CHILD_THREAD, turn: { id: classificationChildTurn } },
      async () => ({ thread: {
        id: CHILD_THREAD, parentThreadId: null, forkedFromId: null,
        source: 'unknown', threadSource: 'subAgentCompact', name: '压缩子任务',
      } }));
    await feed.observe('6v', { threadId: SIDE_THREAD, turn: { id: sideTurn } }, resolveThread);
    await feed.observe('noha', { threadId: THREAD, turn: { id: ordinaryTurn } }, resolveThread);
    await feed.observe('noha', { threadId: THREAD, turn: { id: ordinaryTurn } }, resolveThread);

    assert.deepEqual(feed.events.map((event) => [event.seq, event.hostId, event.threadId]),
      [[1, '6v', SIDE_THREAD], [2, 'noha', THREAD]]);
    assert.equal(feed.sequence, 2);
    assert.deepEqual(client.sent.slice(1).map((frame) => frame.event.threadId), [SIDE_THREAD, THREAD]);
    const restored = new NotificationFeed(f.path);
    assert.deepEqual(restored.events.map((event) => event.turnId), [sideTurn, ordinaryTurn]);
    client.close();
  } finally { f.cleanup(); }
});

test('read failures and unknown thread metadata retain ordinary completion alerts', async () => {
  const f = fixture();
  try {
    const feed = new NotificationFeed(f.path);
    const failedReadTurn = 'faaaaaaa-1234-1234-1234-123456789abc';
    const unknownTurn = 'fabbbbbb-1234-1234-1234-123456789abc';
    const mismatchedTurn = 'fbbbbbbb-1234-1234-1234-123456789abc';
    await feed.observe('6v', { threadId: THREAD, turn: { id: failedReadTurn } },
      async () => { throw Error('read failed'); });
    await feed.observe('6v', { threadId: THREAD, turn: { id: unknownTurn } }, async () => null);
    await feed.observe('noha', { threadId: THREAD, turn: { id: mismatchedTurn } },
      async () => ({ thread: {
        id: CHILD_THREAD, parentThreadId: THREAD, source: { subAgent: 'review' },
      } }));
    assert.deepEqual(feed.events.map((event) => [event.hostId, event.turnId]),
      [['6v', failedReadTurn], ['6v', unknownTurn], ['noha', mismatchedTurn]]);
  } finally { f.cleanup(); }
});

test('fresh subscriptions baseline existing notices; reconnect replays each seq', async () => {
  const f = fixture();
  try {
    const feed = new NotificationFeed(f.path);
    await feed.observe('6v', { threadId: THREAD, turn: { id: TURN } });
    const fresh = socket();
    feed.subscribe(fresh);
    fresh.subscribe(null);
    assert.equal(fresh.sent.length, 1);
    assert.deepEqual(fresh.sent[0].events, []);
    assert.equal(fresh.sent[0].latest, 1);
    const older = socket();
    feed.subscribe(older);
    older.subscribe(0);
    assert.equal(older.sent[0].events.length, 1);
    await feed.observe('noha', { threadId: THREAD,
      turn: { id: 'abcdef12-1234-1234-1234-123456789abd', status: 'interrupted' } });
    assert.equal(fresh.sent[1].type, 'event');
    assert.equal(fresh.sent[1].event.seq, 2);
    assert.equal(older.sent[1].event.hostId, 'noha');
    fresh.close(); older.close();
  } finally { f.cleanup(); }
});

test('reject bogus IDs and cursors', async () => {
  const f = fixture();
  try {
    const feed = new NotificationFeed(f.path);
    await feed.observe('6v', { threadId: '../path', turn: { id: TURN } });
    assert.equal(feed.events.length, 0);
    assert.equal(validCursor(-1), false);
    assert.equal(validCursor(1.5), false);
    assert.equal(validCursor('1'), false);
    assert.equal(validCursor(null), true);
  } finally { f.cleanup(); }
});
