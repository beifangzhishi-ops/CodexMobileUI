import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { TaskInput } from '../shared/automation';
import {
  buildQuotaGuardState, mergeQuotaGuardTriggers, parseQuotaGuardRuntime,
  parseNativeQuotaWindows,
} from '../shared/quotaGuard';
import { createGateway } from '../gateway/main';
import { SchedulerService } from '../gateway/schedulerService';
import { SchedulerStore } from '../gateway/scheduler';
import { QuotaGuardService } from '../gateway/quotaGuardService';
import {
  QuotaGuardSettingStore, quotaGuardFileAdmission,
} from '../gateway/quotaGuardState';

const nativeWindow = (usedPercent: number, windowDurationMins: number | null,
  resetsAt: number | null = 1_780_000_000) => ({
  usedPercent, windowDurationMins, resetsAt,
});

const snapshot = (payload: Record<string, unknown>) => ({
  rateLimits: { primary: nativeWindow(10, 300), secondary: null },
  rateLimitsByLimitId: payload,
});

const waitFor = async (condition: () => boolean, label: string, timeoutMs = 4_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('Timed out waiting for ' + label);
};

test('raw quota scanning covers every native limit id and never rounds the 3% boundary', () => {
  const readings = parseNativeQuotaWindows(snapshot({
    codex: {
      limitId: 'codex', primary: nativeWindow(96.9, 300),
      secondary: nativeWindow(97, 10080),
    },
    'workspace-model': {
      limitId: 'workspace-model', primary: nativeWindow(99.8, 60),
      secondary: null,
    },
    invalid: {
      limitId: 'invalid', primary: nativeWindow(Number.NaN, 300),
      secondary: nativeWindow(-1, 60),
    },
  }));
  assert.equal(readings.length, 3);
  assert.ok(Math.abs((readings.find((item) => item.limitId === 'workspace-model')?.remainingPercent ?? 0) - 0.2) < 1e-9);
  const triggers = mergeQuotaGuardTriggers([], readings, 100);
  assert.deepEqual(new Set(triggers.map((item) => item.limitId)), new Set(['codex', 'workspace-model']));
  assert.equal(triggers.find((item) => item.limitId === 'codex')?.slot, 'secondary');
});

test('proven low windows latch through missing data and clear only on a fresh above-threshold window', () => {
  const first = parseNativeQuotaWindows(snapshot({
    plan: { limitId: 'plan', primary: nativeWindow(98, 300, 100), secondary: null },
  }));
  let triggers = mergeQuotaGuardTriggers([], first, 1_000);
  assert.equal(triggers.length, 1);
  triggers = mergeQuotaGuardTriggers(triggers, [], 2_000);
  assert.equal(triggers.length, 1);
  triggers = mergeQuotaGuardTriggers(triggers,
    parseNativeQuotaWindows({}), 3_000);
  assert.equal(triggers.length, 1);
  triggers = mergeQuotaGuardTriggers(triggers, parseNativeQuotaWindows(snapshot({
    other: { limitId: 'other', primary: nativeWindow(10, 300), secondary: null },
  })), 4_000);
  assert.equal(triggers.length, 1);
  triggers = mergeQuotaGuardTriggers(triggers, parseNativeQuotaWindows(snapshot({
    plan: { limitId: 'plan', primary: nativeWindow(5, 300, 100), secondary: null },
  })), 5_000);
  assert.equal(triggers.length, 0);

  triggers = mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
    plan: { limitId: 'plan', primary: nativeWindow(97, 300, 100), secondary: null },
  })), 6_000);
  triggers = mergeQuotaGuardTriggers(triggers, parseNativeQuotaWindows(snapshot({
    plan: { limitId: 'plan', primary: nativeWindow(4, 300, 200), secondary: null },
  })), 7_000);
  assert.equal(triggers.length, 0, 'a freshly reset native window may clear the prior low');
});

test('authoritative default is off on 6v while an unsynced or stale noha mirror blocks new work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-state-'));
  const replicaDirectory = mkdtempSync(join(tmpdir(), 'quota-guard-replica-'));
  try {
    const store = new QuotaGuardSettingStore(directory, 30_000);
    const replica = new QuotaGuardSettingStore(replicaDirectory, 30_000);
    assert.equal(store.readSettingSync('6v').enabled, false);
    assert.equal(quotaGuardFileAdmission(store, '6v', 135_000).allowed, true);
    assert.equal(replica.readSettingSync('noha').pending, true);
    assert.equal(quotaGuardFileAdmission(replica, 'noha', 135_000).reason, 'QUOTA_GUARD_SYNC_PENDING');

    const changed = await store.setEnabled(true, 0, 100_000);
    assert.equal(changed.enabled, true);
    assert.equal(changed.revision, 1);
    assert.equal(store.readSettingSync('6v').enabled, true);

    replica.writeMirrorSync(false, 0, 1, 100_000);
    assert.equal(replica.readSettingSync('noha', 110_000).pending, false);
    assert.equal(quotaGuardFileAdmission(replica, 'noha', 135_000, 110_000).allowed, true);
    assert.equal(replica.readSettingSync('noha', 131_000).pending, true);
    assert.equal(quotaGuardFileAdmission(replica, 'noha', 135_000, 131_000).reason,
      'QUOTA_GUARD_SYNC_PENDING');
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(replicaDirectory, { recursive: true, force: true });
  }
});

test('shared state keeps observed trigger reasons visible when the peer is offline', () => {
  const setting = { enabled: true, revision: 2, updatedAt: 100,
    syncedAt: 100, pending: false, reason: null };
  const local = parseQuotaGuardRuntime({
    version: 1, hostId: '6v', updatedAt: 100, settingRevision: 2, enabled: true,
    nativeStatus: 'online', lastReadAt: Date.now(), lastReadError: null,
    triggers: mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
      codex: { limitId: 'codex', primary: nativeWindow(97.5, 300), secondary: null },
    }))),
    interrupts: [],
  }, '6v');
  const state = buildQuotaGuardState(setting, true, 'noha offline', 90,
    { '6v': local, noha: null });
  assert.equal(state.status, 'guarded');
  assert.match(state.triggerReason ?? '', /6v/);
  assert.equal(state.sync.state, 'pending');
  assert.equal(state.hosts.noha?.status, 'pending');
});

test('scheduler refuses manual starts and records guarded occurrences without backlog', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-scheduler-'));
  const now = new Date('2026-11-26T00:00:00Z');
  const input: TaskInput = {
    name: 'guard test', prompt: 'Do not run', projectId: 'project',
    schedule: { kind: 'once', at: '2026-11-26T00:01:00.000Z' },
    timeZone: 'UTC', conversationMode: 'new', threadId: null,
    model: null, effort: null, permissionMode: 'read-only', workspaceMode: 'project',
  };
  try {
    const store = new SchedulerStore(join(directory, 'scheduler.sqlite'));
    const task = store.create(input, now);
    store.close();
    const service = new SchedulerService(join(directory, 'oauth.json'),
      'ws://127.0.0.1:65531', { admission: () => ({
        allowed: false, reason: 'QUOTA_GUARD_BLOCKED',
      }) });
    try {
      await assert.rejects(() => service.handle('automation/run', { id: task.id }),
        /QUOTA_GUARD_BLOCKED/);
    } finally { service.close(); }

    const reopened = new SchedulerStore(join(directory, 'scheduler.sqlite'));
    try {
      reopened.skipGuardedOccurrence(task.id, 'QUOTA_GUARD_BLOCKED',
        new Date('2026-11-26T00:02:00Z'));
      assert.equal(reopened.runs(task.id)[0]?.reason, 'QUOTA_GUARD_BLOCKED');
      assert.equal(reopened.get(task.id)?.completed, true);
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('private Gateway blocks a new native turn before forwarding it while low', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-gateway-'));
  const manifest = join(directory, 'hosts.json');
  writeFileSync(manifest, JSON.stringify([
    { name: '6v', url: 'http://100.76.74.124:48889' },
    { name: 'noha', url: 'http://100.96.30.32:48889' },
  ]));
  const native = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    native.once('listening', resolve);
    native.once('error', reject);
  });
  let forwardedWork = 0;
  native.on('connection', (socket) => socket.on('message', (bytes) => {
    const frame = JSON.parse(bytes.toString()) as { id?: number; method?: string };
    if (!frame.id || !frame.method) return;
    if (['turn/start', 'turn/steer', 'thread/queue/add', 'thread/queue/start',
      'thread/goal/set', 'thread/compact/start'].includes(frame.method)) forwardedWork++;
    const result = frame.method === 'account/rateLimits/read'
      ? snapshot({ codex: { limitId: 'codex',
        primary: nativeWindow(99, 300), secondary: null } })
      : frame.method === 'thread/loaded/list' ? { data: [], nextCursor: null } : {};
    socket.send(JSON.stringify({ id: frame.id, result }));
  }));
  const address = native.address();
  if (!address || typeof address === 'string') throw Error('No native test port');
  const store = new QuotaGuardSettingStore(directory);
  await store.setEnabled(true, 0);
  const triggers = mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
    codex: { limitId: 'codex', primary: nativeWindow(99, 300), secondary: null },
  })));
  store.writeRuntimeSync({
    version: 1, hostId: '6v', updatedAt: Date.now(), settingRevision: 1, enabled: true,
    nativeStatus: 'online', lastReadAt: Date.now(), lastReadError: null,
    triggers, interrupts: [],
  });
  const gateway = createGateway({
    publicOrigin: 'https://unused.invalid', secret: 'test-secret',
    redirectUri: 'codexmobileui://oauth', listenPort: 0, privatePort: 0,
    privateManifestFile: manifest, stateFile: join(directory, 'oauth.json'),
    upstream: 'ws://127.0.0.1:' + address.port,
  });
  await gateway.listen();
  const client = new WebSocket('ws://127.0.0.1:' + gateway.port() + '/connect?host=6v', {
    headers: { Host: '100.76.74.124:48889', Origin: 'http://100.76.74.124:48889' },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('gateway ready timeout')), 3_000);
      client.on('message', (bytes) => {
        const frame = JSON.parse(bytes.toString()) as { type?: string };
        if (frame.type === 'ready') { clearTimeout(timeout); resolve(); }
      });
      client.on('open', () => client.send(JSON.stringify({ type: 'connect' })));
    });
    const request = (id: number, method: string, params: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error(method + ' timeout')), 3_000);
        const onMessage = (bytes: import('ws').RawData) => {
          const frame = JSON.parse(bytes.toString()) as {
            id?: number; result?: unknown; error?: { message?: string };
          };
          if (frame.id !== id || !('result' in frame) && !frame.error) return;
          clearTimeout(timeout);
          client.off('message', onMessage);
          resolve(frame as Record<string, unknown>);
        };
        client.on('message', onMessage);
        client.send(JSON.stringify({ id, method, params }));
      });
    const initialized = await request(1, 'initialize', {
      clientInfo: { name: 'codex_multi_host_web', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    assert.ok(initialized.result);
    const blocked = await request(2, 'turn/start', {
      threadId: '019b0000-0000-7000-8000-000000000031',
      input: [{ type: 'text', text: 'must not start' }],
    });
    assert.equal((blocked.error as { message?: string } | undefined)?.message,
      'QUOTA_GUARD_BLOCKED');
    const threadId = '019b0000-0000-7000-8000-000000000031';
    const turnId = '019b0000-0000-7000-8000-000000000032';
    const guarded = [
      ['turn/steer', { threadId, expectedTurnId: turnId,
        input: [{ type: 'text', text: 'must not steer' }] }],
      ['thread/queue/add', { threadId, clientUserMessageId: turnId,
        input: [{ type: 'text', text: 'must not queue' }] }],
      ['thread/queue/start', { threadId, queuedSubmissionId: turnId }],
      ['thread/goal/set', { threadId, origin: 'user', objective: 'must not execute' }],
      ['thread/compact/start', { threadId }],
    ] as const;
    for (let index = 0; index < guarded.length; index++) {
      const [method, params] = guarded[index];
      const response = await request(index + 3, method, params as Record<string, unknown>);
      assert.equal((response.error as { message?: string } | undefined)?.message,
        'QUOTA_GUARD_BLOCKED', method);
    }
    assert.equal(forwardedWork, 0);
  } finally {
    client.terminate();
    await gateway.close();
    for (const connection of native.clients) connection.terminate();
    await new Promise<void>((resolve) => native.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native monitor catches an admission race, interrupts the exact turn and confirms recovery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-native-'));
  const threads = {
    threadId: '019b0000-0000-7000-8000-000000000001',
    turnId: '019b0000-0000-7000-8000-000000000002',
  };
  let readCount = 0;
  let interruptRequests = 0;
  let turnStarts = 0;
  const sockets = new Set<import('ws').WebSocket>();
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (bytes) => {
      const frame = JSON.parse(bytes.toString()) as {
        id?: number; method?: string; params?: Record<string, unknown>;
      };
      if (!frame.id || !frame.method) return;
      if (frame.method === 'initialize') {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
        return;
      }
      if (frame.method === 'account/rateLimits/read') {
        readCount++;
        socket.send(JSON.stringify({ id: frame.id, result: snapshot({
          codex: { limitId: 'codex', primary: nativeWindow(readCount === 1 ? 97 : 50, 300),
            secondary: null },
        }) }));
        if (readCount === 1) {
          setImmediate(() => socket.send(JSON.stringify({ method: 'turn/started',
            params: { threadId: threads.threadId, turn: { id: threads.turnId } } })));
        }
        return;
      }
      if (frame.method === 'thread/loaded/list') {
        socket.send(JSON.stringify({ id: frame.id, result: { data: [], nextCursor: null } }));
        return;
      }
      if (frame.method === 'turn/interrupt') {
        interruptRequests++;
        assert.equal(frame.params?.threadId, threads.threadId);
        assert.equal(frame.params?.turnId, threads.turnId);
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
        setImmediate(() => socket.send(JSON.stringify({ method: 'turn/completed',
          params: { threadId: threads.threadId,
            turn: { id: threads.turnId, status: 'interrupted' } } })));
        return;
      }
      if (frame.method === 'turn/start') turnStarts++;
      socket.send(JSON.stringify({ id: frame.id, result: {} }));
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No native test port');
  try {
    const store = new QuotaGuardSettingStore(directory);
    await store.setEnabled(true, 0);
    const guard = new QuotaGuardService(directory, 'ws://127.0.0.1:' + address.port,
      '6v', { pollMs: 60_000, maxReadAgeMs: 120_000,
        retryDelaysMs: [80, 160, 320] });
    try {
      guard.start();
      await waitFor(() => interruptRequests === 1, 'turn/interrupt admission race');
      await waitFor(() => guard.status().interrupts.some((item) =>
        item.turnId === threads.turnId && item.state === 'confirmed'), 'terminal confirmation');
      assert.equal(guard.admission().reason, 'QUOTA_GUARD_BLOCKED');

      for (const client of sockets) {
        client.send(JSON.stringify({ method: 'account/rateLimits/updated',
          params: { rateLimits: {
            limitId: 'codex', primary: nativeWindow(50, 300), secondary: null,
          } } }));
      }
      await waitFor(() => guard.status().triggers.length === 0, 'fresh quota recovery');
      assert.equal(guard.admission().allowed, true);
      assert.equal(turnStarts, 0, 'recovery never restarts an interrupted turn');
    } finally { guard.close(); }
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native reconnect discovers an already-active turn before admitting more work', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-reconnect-'));
  const threadId = '019b0000-0000-7000-8000-000000000011';
  const turnId = '019b0000-0000-7000-8000-000000000012';
  let connections = 0;
  let interrupts = 0;
  const sockets = new Set<import('ws').WebSocket>();
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  server.on('connection', (socket) => {
    const connection = ++connections;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (bytes) => {
      const frame = JSON.parse(bytes.toString()) as { id?: number; method?: string };
      if (!frame.id || !frame.method) return;
      if (frame.method === 'initialize') {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      } else if (frame.method === 'account/rateLimits/read') {
        socket.send(JSON.stringify({ id: frame.id, result: snapshot({
          codex: { limitId: 'codex', primary: nativeWindow(98, 300), secondary: null },
        }) }));
        if (connection === 1) setTimeout(() => socket.terminate(), 20);
      } else if (frame.method === 'thread/loaded/list') {
        socket.send(JSON.stringify({ id: frame.id,
          result: { data: connection > 1 ? [threadId] : [], nextCursor: null } }));
      } else if (frame.method === 'thread/turns/list') {
        socket.send(JSON.stringify({ id: frame.id, result: {
          data: [{ id: turnId, status: 'inProgress' }], nextCursor: null,
        } }));
      } else if (frame.method === 'turn/interrupt') {
        interrupts++;
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      } else {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      }
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No native test port');
  try {
    const store = new QuotaGuardSettingStore(directory);
    await store.setEnabled(true, 0);
    const guard = new QuotaGuardService(directory, 'ws://127.0.0.1:' + address.port,
      '6v', { pollMs: 60_000, maxReadAgeMs: 120_000,
        retryDelaysMs: [80, 160, 320] });
    try {
      guard.start();
      await waitFor(() => interrupts > 0, 'reconnect active-turn discovery', 5_000);
      assert.equal(guard.admission().reason, 'QUOTA_GUARD_BLOCKED');
    } finally { guard.close(); }
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('native interrupt failures are bounded and remain visibly failed without clearing the latch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-failure-'));
  const threadId = '019b0000-0000-7000-8000-000000000021';
  const turnId = '019b0000-0000-7000-8000-000000000022';
  let interrupts = 0;
  const sockets = new Set<import('ws').WebSocket>();
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (bytes) => {
      const frame = JSON.parse(bytes.toString()) as { id?: number; method?: string };
      if (!frame.id || !frame.method) return;
      if (frame.method === 'initialize') {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      } else if (frame.method === 'account/rateLimits/read') {
        socket.send(JSON.stringify({ id: frame.id, result: snapshot({
          codex: { limitId: 'codex', primary: nativeWindow(99, 300), secondary: null },
        }) }));
        setImmediate(() => socket.send(JSON.stringify({ method: 'turn/started',
          params: { threadId, turn: { id: turnId } } })));
      } else if (frame.method === 'thread/loaded/list') {
        socket.send(JSON.stringify({ id: frame.id, result: { data: [], nextCursor: null } }));
      } else if (frame.method === 'turn/interrupt') {
        interrupts++;
        socket.send(JSON.stringify({ id: frame.id, error: { code: -32000,
          message: 'temporary native failure' } }));
      } else {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      }
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No native test port');
  try {
    const store = new QuotaGuardSettingStore(directory);
    await store.setEnabled(true, 0);
    const guard = new QuotaGuardService(directory, 'ws://127.0.0.1:' + address.port,
      '6v', { pollMs: 60_000, maxReadAgeMs: 120_000,
        retryDelaysMs: [20, 20, 20] });
    try {
      guard.start();
      await waitFor(() => guard.status().interrupts.some((item) =>
        item.turnId === turnId && item.state === 'failed'), 'bounded interrupt failure');
      assert.equal(interrupts, 3);
      assert.equal(guard.status().triggers.length, 1);
      assert.equal(guard.admission().reason, 'QUOTA_GUARD_BLOCKED');
    } finally { guard.close(); }
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
