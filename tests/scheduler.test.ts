import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { SchedulerStore, nextOccurrence, validateTaskInput } from '../gateway/scheduler';
import { executeScheduledTask } from '../gateway/schedulerRunner';
import { SchedulerService } from '../gateway/schedulerService';
import { ScheduleTaskCalls } from '../gateway/scheduleTaskTool';
import { parseTaskRrule } from '../gateway/schedulerRrule';
import { ensureTaskWorktree } from '../gateway/schedulerWorktree';
import type { TaskInput } from '../shared/automation';

const taskInput = (now = new Date()): TaskInput => ({
  name: 'safe test', prompt: 'Read only test', projectId: 'p1',
  schedule: { kind: 'once', at: new Date(now.getTime() + 120_000).toISOString() },
  timeZone: 'UTC', conversationMode: 'new', threadId: null,
  model: null, effort: null, workspaceMode: 'project',
  permissionMode: 'workspace-write',
});

test('reminders create, edit, trigger and recover with native offline and quota blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'scheduler-reminder-'));
  const stateFile = join(directory, 'state.json');
  const unavailable = 'ws://127.0.0.1:0';
  const guard = { admission: () => ({ allowed: false, reason: 'QUOTA_GUARD_BLOCKED' as const }) };
  const service = new SchedulerService(stateFile, unavailable, guard);
  let restarted: SchedulerService | undefined;
  let serviceClosed = false;
  try {
    const input = { ...taskInput(), modelMode: 'none', projectId: '', permissionMode: 'read-only' };
    const task = await service.handle('automation/create', { task: input }) as { id: string; nextRunAt: string };
    await assert.rejects(service.handle('automation/update', { id: task.id, patch: { model: 'fake' } }), /INVALID_TASK/);
    const prompt = '  提交周报\n保留原文  ';
    await service.handle('automation/update', { id: task.id, patch: { prompt } });
    const manual = await service.handle('automation/run', { id: task.id });
    assert.match(JSON.stringify(manual), /"state":"completed"/);
    const overview = await service.handle('automation/list', {});
    assert.match(JSON.stringify(overview), new RegExp(task.nextRunAt.replace('.', '\\.')));
    const first = service.reminderEvents(0);
    assert.equal(first.length, 1);
    assert.equal(first[0].preview, prompt);
    service.close();
    serviceClosed = true;

    const store = new SchedulerStore(join(directory, 'scheduler.sqlite'));
    const earlier = new Date(Date.now() - 600_000);
    const at = new Date(earlier.getTime() + 60_000).toISOString();
    const overdue = store.create({ ...input, schedule: { kind: 'once', at } }, earlier);
    store.close();
    restarted = new SchedulerService(stateFile, unavailable, guard);
    restarted.start();
    const events = restarted.reminderEvents(first[0].cursor);
    assert.equal(events.length, 1);
    assert.equal(events[0].taskId, overdue.id);
    const runs = await restarted.handle('automation/runs', { taskId: overdue.id });
    assert.match(JSON.stringify(runs), /"threadId":null,"turnId":null/);
    assert.match(JSON.stringify(runs), new RegExp(at.replace('.', '\\.')));
    assert.deepEqual(restarted.reminderEvents(events[0].cursor), []);
  } finally {
    if (!serviceClosed) service.close();
    restarted?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduled local times honor zones, weekdays and half-hour offsets', () => {
  assert.equal(nextOccurrence({ kind: 'daily', hour: 9, minute: 30 }, 'Asia/Kolkata',
    new Date('2026-11-13T04:01:00Z')), '2026-11-14T04:00:00.000Z');
  assert.equal(nextOccurrence({ kind: 'weekdays', hour: 9, minute: 0 }, 'UTC',
    new Date('2026-11-13T09:00:00Z')), '2026-11-16T09:00:00.000Z');
  assert.equal(nextOccurrence({ kind: 'weekly', days: [0], hour: 12, minute: 0 }, 'UTC',
    new Date('2026-11-13T01:00:00Z')), '2026-11-15T12:00:00.000Z');
  assert.equal(nextOccurrence({ kind: 'daily', hour: 2, minute: 30 }, 'America/New_York',
    new Date('2026-03-08T06:00:00Z')), '2026-03-09T06:30:00.000Z');
});

test('task validation rejects arbitrary fields and invalid recurrence', () => {
  const valid = taskInput();
  assert.deepEqual(validateTaskInput(valid), valid);
  assert.throws(() => validateTaskInput({ ...valid, cwd: 'C:\\Windows' }), /INVALID_TASK/);
  assert.throws(() => validateTaskInput({ ...valid,
    schedule: { kind: 'weekly', days: [1, 1], hour: 9, minute: 0 } }), /INVALID_SCHEDULE/);
  assert.throws(() => validateTaskInput({ ...valid, workspaceMode: 'full-access' }), /INVALID_TASK/);
});

test('bounded custom RRULE supports calendar intervals without accepting unsafe grammar', () => {
  assert.equal(nextOccurrence({ kind: 'rrule',
    rule: 'FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=0',
    startAt: '2026-11-13T00:00:00.000Z' }, 'UTC',
  new Date('2026-11-13T10:00:00Z')), '2026-11-15T09:00:00.000Z');
  assert.equal(nextOccurrence({ kind: 'rrule',
    rule: 'FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=0',
    startAt: '2026-11-13T00:00:00.000Z' }, 'Asia/Shanghai',
  new Date('2026-11-13T00:01:00Z')), '2026-11-13T01:00:00.000Z');
  assert.throws(() => parseTaskRrule('FREQ=SECONDLY;INTERVAL=1'), /INVALID_RRULE/);
  assert.throws(() => parseTaskRrule('FREQ=WEEKLY;COUNT=10000'), /INVALID_RRULE/);
});

test('SQLite keeps task records across restarts and never replays interrupted turns', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'scheduler-')), 'tasks.sqlite');
  try {
    const store = new SchedulerStore(path);
    const task = store.create(taskInput());
    assert.equal(store.list().length, 1);
    store.toggle(task.id, false);
    assert.equal(store.get(task.id)?.enabled, false);
    store.toggle(task.id, true);
    const started = store.beginRun(task.id, 'manual');
    store.assignThread(started.id, 'thread-created');
    assert.throws(() => store.beginRun(task.id, 'manual'), /TASK_BUSY/);
    store.close();
    const reopened = new SchedulerStore(path);
    assert.equal(reopened.runs(task.id)[0]?.state, 'interrupted');
    assert.equal(reopened.runs(task.id)[0]?.threadId, 'thread-created');
    assert.equal(reopened.unseen().length, 1);
    reopened.markSeen(started.id);
    assert.equal(reopened.unseen().length, 0);
    reopened.close();
  } finally { rmSync(join(path, '..'), { recursive: true, force: true }); }
});

test('overdue schedules get missed records instead of backlog execution', () => {
  const store = new SchedulerStore(':memory:');
  try {
    const now = new Date('2026-11-13T10:00:00Z');
    const task = store.create({ ...taskInput(now),
      schedule: { kind: 'once', at: '2026-11-13T10:01:00.000Z' } }, now);
    store.skipOverdue(new Date('2026-11-13T12:00:00Z'));
    assert.equal(store.get(task.id)?.completed, true);
    assert.equal(store.get(task.id)?.enabled, false);
    assert.equal(store.runs(task.id)[0]?.reason, 'MISSED_WHILE_OFFLINE');
  } finally { store.close(); }
});

test('isolated Git worktrees persist per task without changing the source checkout', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'scheduler-git-'));
  const repo = join(directory, 'source');
  const state = join(directory, 'state');
  mkdirSync(repo);
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], {
      windowsHide: true, stdio: 'pipe', timeout: 30_000,
    });
    try { git('init', '-q'); }
    catch (error) {
      // CCM sandbox may forbid subprocess spawning inside a Node test process.
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        t.skip('CCM sandbox denied git subprocess spawning');
        return;
      }
      throw error;
    }
    writeFileSync(join(repo, 'tracked.txt'), 'source');
    git('add', 'tracked.txt');
    git('-c', 'user.name=Automation Test', '-c', 'user.email=test@example.invalid',
      'commit', '-qm', 'initial');
    const taskId = randomUUID();
    const worktree = await ensureTaskWorktree(repo, taskId, state);
    assert.equal(readFileSync(join(worktree, 'tracked.txt'), 'utf8'), 'source');
    writeFileSync(join(worktree, 'tracked.txt'), 'edited by task');
    assert.equal(await ensureTaskWorktree(repo, taskId, state), worktree);
    assert.equal(readFileSync(join(worktree, 'tracked.txt'), 'utf8'), 'edited by task');
    assert.equal(readFileSync(join(repo, 'tracked.txt'), 'utf8'), 'source');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('native scheduler starts a real RPC-shaped turn, awaits completion and exposes history', async () => {
  const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => ws.once('listening', resolve));
  const address = ws.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const calls: string[] = [];
  const modelList = { data: [
    { id: 'picker-id', model: 'test-model', displayName: 'Test model', isDefault: true,
      supportedReasoningEfforts: [{ reasoningEffort: 'high' }], defaultReasoningEffort: 'high' },
    { model: 'hidden-model', hidden: true },
  ] };
  const nativeRequests: { method: string; params: Record<string, unknown> }[] = [];
  ws.on('connection', (socket) => socket.on('message', (message) => {
    const frame = JSON.parse(message.toString()) as {
      id?: number; method: string; params: Record<string, unknown>;
    };
    calls.push(frame.method);
    nativeRequests.push({ method: frame.method, params: frame.params });
    if (!frame.id) return;
    const result = frame.method === 'project/read'
      ? { project: { id: 'p1', roots: [{ path: process.cwd() }] } }
      : frame.method === 'thread/start' ? { thread: { id: 't1' } }
        : frame.method === 'thread/resume' ? { thread: { id: 't1' } }
          : frame.method === 'turn/start' ? { turn: { id: 'turn1' } }
            : frame.method === 'model/list' ? modelList : {};
    socket.send(JSON.stringify({ id: frame.id, result }));
    if (frame.method === 'turn/start') {
      setImmediate(() => socket.send(JSON.stringify({ method: 'turn/completed',
        params: { threadId: 't1', turn: { id: 'turn1', status: 'completed' } } })));
    }
  }));
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-service-'));
  const upstream = `ws://127.0.0.1:${address.port}`;
  const service = new SchedulerService(join(dir, 'oauth.json'), upstream);
  try {
    const input = { ...taskInput(), model: 'test-model', effort: 'high' };
    const created = await service.handle('automation/create', { task: input }) as { id: string };
    assert.ok(created.id);
    const started = await service.handle('automation/run', { id: created.id }) as { id: string };
    for (let i = 0; i < 80; i++) {
      const data = await service.handle('automation/runs', { taskId: created.id }) as {
        data: { state: string; threadId: string; turnId: string }[];
      };
      if (data.data[0]?.state === 'completed') {
        assert.equal(data.data[0].threadId, 't1');
        assert.equal(data.data[0].turnId, 'turn1');
        break;
      }
      if (i === 79) assert.fail('runner never completed');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(started.id);
    assert.ok(calls.includes('initialize'));
    assert.ok(calls.includes('thread/start'));
    assert.ok(calls.includes('turn/start'));
    const startThread = nativeRequests.find((req) => req.method === 'thread/start');
    const startTurn = nativeRequests.find((req) => req.method === 'turn/start');
    assert.equal(startThread?.params.permissions, ':workspace');
    assert.equal(startTurn?.params.permissions, ':workspace');
    assert.equal(startTurn?.params.model, 'test-model');
    assert.equal(startTurn?.params.effort, 'high');
    assert.equal(startThread?.params.approvalPolicy, 'never');
    assert.equal(startTurn?.params.approvalPolicy, 'never');
    assert.equal('sandbox' in (startTurn?.params ?? {}), false);
    const inbox = await service.handle('automation/inbox', {}) as { data: { id: string }[] };
    assert.equal(inbox.data.length, 1);
    assert.equal(inbox.data[0].id, started.id);
    await service.handle('automation/read', { runId: started.id });
    assert.equal((await service.handle('automation/inbox', {}) as { data: unknown[] }).data.length, 0);

    const tool = new ScheduleTaskCalls(async (method, params) => {
      if (method === 'model/list') return modelList;
      assert.equal(method, 'thread/read');
      return { thread: { id: params.threadId, projectId: 'p1' } };
    }, (method, params) => service.handle(method, params));
    const args = { name: input.name, prompt: input.prompt, timeZone: input.timeZone,
      schedule: input.schedule, conversationMode: 'new' };
    const callback = { namespace: null, tool: 'schedule_task', threadId: 't1',
      turnId: 'turn2', callId: 'call1', arguments: args };
    const catalog = await tool.handle({ ...callback, tool: 'list_schedule_models', arguments: {} });
    assert.equal(catalog?.success, true);
    assert.deepEqual(JSON.parse(catalog!.contentItems[0].text), { models: [{
      model: 'test-model', name: 'Test model', isDefault: true, defaultEffort: 'high', efforts: ['high'],
    }] });
    const invalid = await tool.handle({ ...callback, arguments: { ...args, permissionMode: 'workspace-write' } });
    assert.equal(invalid?.success, false);
    const invalidEffort = await tool.handle({
      ...callback, arguments: { ...args, model: 'test-model', effort: 'low' },
    });
    assert.equal(invalidEffort?.contentItems[0].text, 'EFFORT_NOT_SUPPORTED');
    const explicit = { ...callback, arguments: { ...args, model: 'test-model', effort: 'high' } };
    const creation = tool.handle(explicit);
    assert.equal(tool.handle(explicit), creation);
    assert.equal((await tool.handle({ ...callback, callId: 'call2' }))?.success, false);
    const output = await creation;
    assert.equal(output?.success, true);
    const saved = JSON.parse(output!.contentItems[0].text);
    assert.equal(saved.nextRunAt, input.schedule.kind === 'once' && input.schedule.at);
    assert.equal(saved.model, 'test-model');
    assert.equal(saved.effort, 'high');
    const list = await service.handle('automation/list', {}) as {
      data: (TaskInput & { id: string })[];
    };
    assert.equal(list.data.length, 2);
    const scheduled = list.data.find((task) => task.id === saved.id);
    assert.equal(scheduled?.projectId, 'p1');
    assert.equal(scheduled?.permissionMode, 'read-only');
    assert.equal(scheduled?.effort, 'high');
    assert.equal(scheduled?.threadId, null);
  } finally {
    service.close();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
