import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { TaskInput } from '../shared/automation';
import {
  buildQuotaGuardState, mergeQuotaGuardTriggers, parseQuotaGuardRuntime,
  parseNativeQuotaWindows, type QuotaGuardRuntime, type QuotaHostId,
} from '../shared/quotaGuard';
import { createGateway } from '../gateway/main';
import { SchedulerService } from '../gateway/schedulerService';
import { SchedulerStore } from '../gateway/scheduler';
import { QuotaGuardService } from '../gateway/quotaGuardService';
import {
  handleQuotaGuardPeerSync, synchronizeQuotaGuardPeer,
  type QuotaGuardPeerSyncRequest,
} from '../gateway/quotaGuardPeer';
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

type PeerSyncSession = {
  request: (params: QuotaGuardPeerSyncRequest, timeoutMs?: number) => Promise<unknown>;
  close: () => void;
};

const connectQuotaGuardPeer = async (port: number, credential: string): Promise<PeerSyncSession> => {
  const socket = new WebSocket('ws://127.0.0.1:' + port + '/peer', {
    headers: { Authorization: 'Bearer ' + credential },
  });
  const pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  let sequence = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('peer ready timeout')), 3_000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onError = () => { cleanup(); reject(Error('peer connection failed')); };
    const onClose = () => { cleanup(); reject(Error('peer closed before ready')); };
    socket.once('error', onError);
    socket.once('close', onClose);
    socket.on('message', (bytes) => {
      const frame = JSON.parse(bytes.toString()) as {
        type?: string; id?: number; result?: unknown; error?: { message?: string };
      };
      if (frame.type === 'ready') {
        cleanup();
        resolve();
        return;
      }
      if (!Number.isSafeInteger(frame.id)) return;
      const request = pending.get(frame.id!);
      if (!request) return;
      pending.delete(frame.id!);
      clearTimeout(request.timer);
      if (frame.error) request.reject(Error(frame.error.message ?? 'peer request failed'));
      else request.resolve(frame.result);
    });
  });
  socket.on('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error('peer disconnected'));
    }
    pending.clear();
  });
  return {
    request(params, timeoutMs = 3_000) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error('peer request timeout'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method: 'web/quotaGuard', params }));
      });
    },
    close() { socket.close(); },
  };
};

const startQuotaGuardPeerServer = async (store: QuotaGuardSettingStore,
  credential: string) => {
  const server = createHttpServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const authorized = new URL(request.url ?? '/', 'http://localhost').pathname === '/peer' &&
      request.headers.authorization === 'Bearer ' + credential;
    if (!authorized) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      client.send(JSON.stringify({ type: 'ready' }));
      client.on('message', (bytes) => {
        let frame: { id?: number; method?: string; params?: unknown };
        try { frame = JSON.parse(bytes.toString()); } catch { return; }
        if (!Number.isSafeInteger(frame.id) || frame.method !== 'web/quotaGuard') return;
        try {
          const result = handleQuotaGuardPeerSync(store, frame.params, '6v', 'noha');
          client.send(JSON.stringify({ id: frame.id, result }));
        } catch (error) {
          client.send(JSON.stringify({ id: frame.id, error: {
            message: error instanceof Error ? error.message : 'peer sync failed',
          } }));
        }
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No quota peer port');
  return {
    port: address.port,
    async close() {
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const runtimeFor = (hostId: QuotaHostId, options: {
  revision?: number; triggers?: QuotaGuardRuntime['triggers'];
  now?: number; discovery?: QuotaGuardRuntime['discovery'];
} = {}): QuotaGuardRuntime => {
  const now = options.now ?? Date.now();
  return {
    version: 1, hostId, revision: options.revision ?? 1, updatedAt: now,
    settingRevision: 1, enabled: true, nativeStatus: 'online', lastReadAt: now,
    lastReadError: null, discovery: options.discovery ?? 'complete',
    triggers: options.triggers ?? [], interrupts: [],
  };
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
  })), 500);
  assert.equal(triggers.length, 1, 'an older full read cannot clear a newer low');
  triggers = mergeQuotaGuardTriggers(triggers, parseNativeQuotaWindows(snapshot({
    plan: { limitId: 'plan', primary: nativeWindow(5, 300, 100), secondary: null },
  })), 5_000);
  assert.equal(triggers.length, 0);

  triggers = mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
    plan: { limitId: 'plan', primary: nativeWindow(97, 300, 100), secondary: null },
  })), 6_000);
  triggers = mergeQuotaGuardTriggers(triggers, parseNativeQuotaWindows(snapshot({
    plan: { limitId: 'plan', primary: nativeWindow(4, 300, 50), secondary: null },
  })), 7_000);
  assert.equal(triggers.length, 1, 'an older reset timestamp cannot clear the latch');
  triggers = mergeQuotaGuardTriggers(triggers, parseNativeQuotaWindows(snapshot({
    plan: { limitId: 'plan', primary: nativeWindow(4, 300, 200), secondary: null },
  })), 8_000);
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

    writeFileSync(store.settingFile, JSON.stringify({
      version: 1, enabled: false, revision: 0, updatedAt: 1, syncedAt: 1,
    }));
    assert.equal(store.readAuthoritativeSync().thresholdPercent, 3);
    await assert.rejects(store.setEnabled(true, 0, 100_000, 101), /QUOTA_GUARD_INVALID_PARAMS/);
    const changed = await store.setEnabled(true, 0, 100_000, 8);
    assert.equal(changed.enabled, true);
    assert.equal(changed.revision, 1);
    assert.equal(changed.thresholdPercent, 8);
    assert.equal(store.readAuthoritativeSync().thresholdPercent, 8);
    await synchronizeQuotaGuardPeer(store, '6v', 'noha', async (params) =>
      handleQuotaGuardPeerSync(replica, params, '6v', 'noha', 100_000), 100_000);
    assert.equal(replica.readMirrorSync(100_000).thresholdPercent, 8);
    const readings = parseNativeQuotaWindows(snapshot({
      codex: { limitId: 'codex', primary: nativeWindow(92, 300), secondary: null },
    }));
    const triggers = mergeQuotaGuardTriggers([], readings, 100_000, changed.thresholdPercent);
    assert.equal(triggers.length, 1);
    assert.deepEqual(mergeQuotaGuardTriggers(triggers, readings, 101_000, 7), []);
    await store.setEnabled(true, 1, 101_000, 7);
    await assert.rejects(store.setEnabled(true, 1, 102_000, 6), /QUOTA_GUARD_CONFLICT/);
    assert.equal(store.readSettingSync('6v').enabled, true);

    replica.writeMirrorSync(false, 2, 101_000, 100_000, 7);
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

test('peer latch preserves a low across age and ignores older clears until a newer confirmed snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-peer-latch-'));
  try {
    const store = new QuotaGuardSettingStore(directory);
    const now = Date.now();
    await store.setEnabled(true, 0, now);
    store.writeRuntimeSync(runtimeFor('6v', { now, revision: 3 }));
    const low = runtimeFor('noha', { now, revision: 9,
      triggers: mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
        codex: { limitId: 'codex', primary: nativeWindow(98, 300), secondary: null },
      }))),
    });
    store.writePeerRuntimeSync(low, 'noha', now);
    assert.equal(quotaGuardFileAdmission(store, '6v', 135_000, now + 1_000).reason,
      'QUOTA_GUARD_PEER_BLOCKED');

    store.writePeerRuntimeSync(runtimeFor('noha', {
      now: now + 1_500, revision: 9,
    }), 'noha', now + 1_500);
    assert.equal(store.readPeerRuntimeSync('noha')?.runtime.triggers.length, 1,
      'a same-revision clear cannot replace a durable peer low');

    store.writePeerRuntimeSync(runtimeFor('noha', {
      now: now + 2_000, revision: 8,
    }), 'noha', now + 2_000);
    assert.equal(store.readPeerRuntimeSync('noha')?.runtime.revision, 9,
      'an older clear cannot replace the durable peer low');
    assert.equal(quotaGuardFileAdmission(store, '6v', 135_000, now + 61_000).reason,
      'QUOTA_GUARD_PEER_BLOCKED', 'an offline peer low stays blocking');

    store.writePeerRuntimeSync(runtimeFor('noha', {
      now: now + 62_000, revision: 10,
    }), 'noha', now + 62_000);
    assert.equal(quotaGuardFileAdmission(store, '6v', 135_000, now + 62_000).allowed, true,
      'only the peer host newer clear restores admission');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('malformed peer runtimes are rejected without weakening an existing latch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-peer-invalid-'));
  try {
    const store = new QuotaGuardSettingStore(directory);
    const now = Date.now();
    await store.setEnabled(true, 0, now);
    const triggers = mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
      codex: { limitId: 'codex', primary: nativeWindow(98, 300), secondary: null },
    })), now);
    store.writePeerRuntimeSync(runtimeFor('noha', {
      now, revision: 4, triggers,
    }), 'noha', now);
    const malformed = runtimeFor('noha', { now: now + 1_000, revision: 5 });
    malformed.triggers = [{
      ...triggers[0],
      windowKey: 'forged-window-key',
    }];
    assert.equal(parseQuotaGuardRuntime(malformed, 'noha'), null);
    assert.throws(() => store.writePeerRuntimeSync(malformed, 'noha'),
      /QUOTA_GUARD_PEER_STATE_INVALID/);
    assert.equal(store.readPeerRuntimeSync('noha')?.runtime.triggers.length, 1);
    assert.equal(quotaGuardFileAdmission(store, '6v', 135_000, now + 1_000).reason,
      'QUOTA_GUARD_PEER_BLOCKED');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('authenticated peer sync carries each host latch in both directions and survives an outage', async () => {
  const coordinatorDirectory = mkdtempSync(join(tmpdir(), 'quota-peer-coordinator-'));
  const agentDirectory = mkdtempSync(join(tmpdir(), 'quota-peer-agent-'));
  const credential = 'a'.repeat(64);
  const now = Date.now();
  let server: Awaited<ReturnType<typeof startQuotaGuardPeerServer>> | null = null;
  let session: PeerSyncSession | null = null;
  try {
    const coordinator = new QuotaGuardSettingStore(coordinatorDirectory);
    const agent = new QuotaGuardSettingStore(agentDirectory);
    await coordinator.setEnabled(true, 0, now);
    const sixLow = mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
      codex: { limitId: 'codex', primary: nativeWindow(98, 300, 1_800_000_000), secondary: null },
    })), now);
    coordinator.writeRuntimeSync(runtimeFor('6v', {
      now, revision: 2, triggers: sixLow,
    }));
    agent.writeRuntimeSync(runtimeFor('noha', { now, revision: 1 }));

    server = await startQuotaGuardPeerServer(agent, credential);
    await new Promise<void>((resolve, reject) => {
      const unauthorized = new WebSocket('ws://127.0.0.1:' + server!.port + '/peer', {
        headers: { Authorization: 'Bearer ' + 'b'.repeat(64) },
      });
      const timer = setTimeout(() => reject(Error('unauthorized peer timeout')), 2_000);
      unauthorized.once('open', () => reject(Error('unauthorized peer connected')));
      unauthorized.once('unexpected-response', (_request, response) => {
        clearTimeout(timer);
        try {
          assert.equal(response.statusCode, 403);
          response.resume();
          resolve();
        } catch (error) { reject(error as Error); }
      });
      unauthorized.once('error', () => undefined);
    });

    session = await connectQuotaGuardPeer(server.port, credential);
    const peerSix = await synchronizeQuotaGuardPeer(
      coordinator, '6v', 'noha', session.request, now);
    assert.equal(peerSix?.hostId, 'noha');
    assert.equal(agent.readSettingSync('noha', now).enabled, true);
    assert.equal(agent.readPeerRuntimeSync('6v')?.runtime.triggers.length, 1);
    assert.equal(quotaGuardFileAdmission(agent, 'noha', 135_000, now).reason,
      'QUOTA_GUARD_PEER_BLOCKED');

    const nohaLow = mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
      plan: { limitId: 'plan', primary: nativeWindow(97.5, 10080, 1_800_100_000), secondary: null },
    })), now + 1_000);
    agent.writeRuntimeSync(runtimeFor('noha', {
      now: now + 1_000, revision: 2, triggers: nohaLow,
    }));
    coordinator.writeRuntimeSync(runtimeFor('6v', {
      now: now + 1_000, revision: 3,
    }));
    const peerNoha = await synchronizeQuotaGuardPeer(
      coordinator, '6v', 'noha', session.request, now + 1_000);
    assert.equal(peerNoha?.triggers.length, 1);
    assert.equal(coordinator.readPeerRuntimeSync('noha')?.runtime.triggers.length, 1);
    assert.equal(quotaGuardFileAdmission(coordinator, '6v', 135_000, now + 1_000).reason,
      'QUOTA_GUARD_PEER_BLOCKED');

    session.close();
    session = null;
    await server.close();
    server = null;
    await assert.rejects(synchronizeQuotaGuardPeer(
      coordinator, '6v', 'noha', async () => {
        throw Error('PEER_OFFLINE');
      }, now + 2_000), /PEER_OFFLINE/);
    assert.equal(coordinator.readPeerRuntimeSync('noha')?.runtime.triggers.length, 1);
    assert.equal(quotaGuardFileAdmission(coordinator, '6v', 135_000, now + 31_000).reason,
      'QUOTA_GUARD_PEER_BLOCKED');

    server = await startQuotaGuardPeerServer(agent, credential);
    agent.writeRuntimeSync(runtimeFor('noha', {
      now: now + 40_000, revision: 3,
    }));
    session = await connectQuotaGuardPeer(server.port, credential);
    const cleared = await synchronizeQuotaGuardPeer(
      coordinator, '6v', 'noha', session.request, now + 40_000);
    assert.equal(cleared?.triggers.length, 0);
    assert.equal(coordinator.readPeerRuntimeSync('noha')?.runtime.triggers.length, 0);
    coordinator.writeRuntimeSync(runtimeFor('6v', {
      now: now + 40_000, revision: 4,
    }));
    assert.equal(quotaGuardFileAdmission(coordinator, '6v', 135_000, now + 40_000).allowed,
      true);
  } finally {
    session?.close();
    await server?.close();
    rmSync(coordinatorDirectory, { recursive: true, force: true });
    rmSync(agentDirectory, { recursive: true, force: true });
  }
});

test('shared state keeps observed trigger reasons visible when the peer is offline', () => {
  const setting = { enabled: true, thresholdPercent: 3, revision: 2, updatedAt: 100,
    syncedAt: 100, pending: false, reason: null };
  const local = parseQuotaGuardRuntime(runtimeFor('6v', {
    revision: 2,
    triggers: mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
      codex: { limitId: 'codex', primary: nativeWindow(97.5, 300), secondary: null },
    }))),
  }), '6v');
  const state = buildQuotaGuardState(setting, true, 'noha offline', 90,
    { '6v': local, noha: null });
  assert.equal(state.status, 'guarded');
  assert.match(state.triggerReason ?? '', /6v/);
  assert.equal(state.sync.state, 'pending');
  assert.equal(state.hosts.noha?.status, 'pending');
});

test('an empty native rate-limit response never establishes fresh readiness', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-empty-native-'));
  try {
    const store = new QuotaGuardSettingStore(directory);
    const now = Date.now();
    await store.setEnabled(true, 0, now);
    store.writeRuntimeSync(runtimeFor('6v', { now, revision: 1 }));
    store.writePeerRuntimeSync(runtimeFor('noha', { now }), 'noha', now);
    const guard = new QuotaGuardService(directory, 'ws://127.0.0.1:65531', '6v', {
      pollMs: 60_000, peerPollMs: 60_000,
    });
    try {
      await guard.observeRateLimitResponse({}, now);
      assert.equal(guard.status().lastReadAt, null);
      assert.equal(guard.status().lastReadError, 'QUOTA_SNAPSHOT_INVALID_OR_EMPTY');
      assert.equal(guard.admission(now).reason, 'QUOTA_GUARD_MONITOR_UNAVAILABLE');
      assert.equal(guard.status().triggers.length, 0);
    } finally { guard.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('a full read racing a newer sparse notification cannot clear the newer low', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-read-race-'));
  let firstResponse: (() => void) | null = null;
  let secondResponse: (() => void) | null = null;
  let reads = 0;
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
        reads++;
        const result = snapshot({
          codex: { limitId: 'codex',
            primary: nativeWindow(10, 300, 1_800_000_000), secondary: null },
        });
        const respond = () => socket.send(JSON.stringify({ id: frame.id, result }));
        if (reads === 1) {
          firstResponse = respond;
          setImmediate(() => socket.send(JSON.stringify({
            method: 'account/rateLimits/updated',
            params: { rateLimits: { limitId: 'codex', limitName: 'Codex',
              primary: nativeWindow(98, 300, 1_800_000_000), secondary: null } },
          })));
        } else if (reads === 2) {
          secondResponse = respond;
        } else {
          respond();
        }
      } else if (frame.method === 'thread/loaded/list') {
        socket.send(JSON.stringify({ id: frame.id, result: { data: [], nextCursor: null } }));
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
      '6v', { pollMs: 60_000, peerPollMs: 60_000 });
    try {
      guard.start();
      await waitFor(() => firstResponse !== null && guard.status().triggers.length === 1,
        'newer sparse low');
      firstResponse!();
      await waitFor(() => secondResponse !== null, 'post-notification full refresh');
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(guard.status().triggers.length, 1,
        'the older full read cannot overwrite the sparse low');
      secondResponse!();
      await waitFor(() => guard.status().triggers.length === 0,
        'a later full read confirms recovery');
    } finally { guard.close(); }
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
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
  store.writeRuntimeSync(runtimeFor('6v', { triggers }));
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
    const peerNow = Date.now();
    store.writePeerRuntimeSync(runtimeFor('noha', { now: peerNow }), 'noha', peerNow);
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
      const frame = JSON.parse(bytes.toString()) as {
        id?: number; method?: string; params?: { cursor?: string; threadId?: string };
      };
      if (!frame.id || !frame.method) return;
      if (frame.method === 'initialize') {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      } else if (frame.method === 'account/rateLimits/read') {
        socket.send(JSON.stringify({ id: frame.id, result: snapshot({
          codex: { limitId: 'codex', primary: nativeWindow(98, 300), secondary: null },
        }) }));
        if (connection === 1) setTimeout(() => socket.terminate(), 20);
      } else if (frame.method === 'thread/loaded/list') {
        const params = frame.params;
        socket.send(JSON.stringify({ id: frame.id,
          result: params?.cursor === 'next'
            ? { data: [threadId], nextCursor: null }
            : { data: [connection > 1 ? '019b0000-0000-7000-8000-000000000019' : ''],
              nextCursor: connection > 1 ? 'next' : null } }));
      } else if (frame.method === 'thread/turns/list') {
        const requestThreadId = frame.params?.threadId;
        socket.send(JSON.stringify({ id: frame.id, result: {
          data: requestThreadId === threadId ? [{ id: turnId, status: 'inProgress' }] : [],
          nextCursor: null,
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
    const peerNow = Date.now();
    store.writePeerRuntimeSync(runtimeFor('noha', { now: peerNow }), 'noha', peerNow);
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

test('enabling protection interrupts an already active turn for a retained peer low', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-enable-peer-'));
  const threadId = '019b0000-0000-7000-8000-000000000061';
  const turnId = '019b0000-0000-7000-8000-000000000062';
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
      const frame = JSON.parse(bytes.toString()) as {
        id?: number; method?: string; params?: Record<string, unknown>;
      };
      if (!frame.id || !frame.method) return;
      if (frame.method === 'initialize') {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      } else if (frame.method === 'account/rateLimits/read') {
        socket.send(JSON.stringify({ id: frame.id, result: snapshot({
          codex: { limitId: 'codex', primary: nativeWindow(10, 300), secondary: null },
        }) }));
      } else if (frame.method === 'thread/loaded/list') {
        socket.send(JSON.stringify({ id: frame.id, result: { data: [], nextCursor: null } }));
      } else if (frame.method === 'turn/interrupt') {
        interrupts++;
        assert.equal(frame.params?.threadId, threadId);
        assert.equal(frame.params?.turnId, turnId);
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
        setImmediate(() => socket.send(JSON.stringify({ method: 'turn/completed',
          params: { threadId, turn: { id: turnId, status: 'interrupted' } } })));
      } else {
        socket.send(JSON.stringify({ id: frame.id, result: {} }));
      }
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No native test port');
  try {
    const store = new QuotaGuardSettingStore(directory);
    const now = Date.now();
    const triggers = mergeQuotaGuardTriggers([], parseNativeQuotaWindows(snapshot({
      codex: { limitId: 'codex', primary: nativeWindow(98, 300), secondary: null },
    })), now);
    store.writePeerRuntimeSync(runtimeFor('noha', {
      now, revision: 4, triggers,
    }), 'noha', now);
    const guard = new QuotaGuardService(directory, 'ws://127.0.0.1:' + address.port,
      '6v', { pollMs: 60_000, peerPollMs: 20, retryDelaysMs: [20, 40, 80] });
    try {
      guard.start();
      await waitFor(() => guard.status().lastReadAt !== null, 'healthy native startup');
      for (const socket of sockets) {
        socket.send(JSON.stringify({ method: 'turn/started',
          params: { threadId, turn: { id: turnId } } }));
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.equal(interrupts, 0, 'the disabled guard leaves the active turn alone');
      await store.setEnabled(true, 0);
      await waitFor(() => interrupts === 1, 'enabling protection interrupts active work');
      assert.equal(guard.admission().reason, 'QUOTA_GUARD_PEER_BLOCKED');
    } finally { guard.close(); }
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a durable low on either host interrupts the healthy peer active turn in both directions', async () => {
  const directions = [
    { lowHost: '6v' as const, activeHost: 'noha' as const },
    { lowHost: 'noha' as const, activeHost: '6v' as const },
  ];
  for (const direction of directions) {
    const dirs: Record<QuotaHostId, string> = {
      '6v': mkdtempSync(join(tmpdir(), 'quota-cross-6v-')),
      noha: mkdtempSync(join(tmpdir(), 'quota-cross-noha-')),
    };
    const servers: Partial<Record<QuotaHostId, WebSocketServer>> = {};
    const guards: Partial<Record<QuotaHostId, QuotaGuardService>> = {};
    const setLowCallbacks: Partial<Record<QuotaHostId, (value: boolean) => void>> = {};
    const socketSets: Record<QuotaHostId, Set<import('ws').WebSocket>> = {
      '6v': new Set(), noha: new Set(),
    };
    const interruptCalls: Record<QuotaHostId, { threadId: string; turnId: string }[]> = {
      '6v': [], noha: [],
    };
    try {
      for (const hostId of ['6v', 'noha'] as const) {
        let low = false;
        const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
        servers[hostId] = server;
        await new Promise<void>((resolve, reject) => {
          server.once('listening', resolve);
          server.once('error', reject);
        });
        server.on('connection', (socket) => {
          socketSets[hostId].add(socket);
          socket.on('close', () => socketSets[hostId].delete(socket));
          socket.on('message', (bytes) => {
            const frame = JSON.parse(bytes.toString()) as {
              id?: number; method?: string; params?: Record<string, unknown>;
            };
            if (!frame.id || !frame.method) return;
            if (frame.method === 'initialize') {
              socket.send(JSON.stringify({ id: frame.id, result: {} }));
            } else if (frame.method === 'account/rateLimits/read') {
              socket.send(JSON.stringify({ id: frame.id, result: snapshot({
                codex: { limitId: 'codex',
                  primary: nativeWindow(low ? 98 : 10, 300, 1_800_000_000),
                  secondary: null },
              }) }));
            } else if (frame.method === 'thread/loaded/list') {
              socket.send(JSON.stringify({ id: frame.id,
                result: { data: [], nextCursor: null } }));
            } else if (frame.method === 'turn/interrupt') {
              const threadId = frame.params?.threadId as string;
              const turnId = frame.params?.turnId as string;
              interruptCalls[hostId].push({ threadId, turnId });
              socket.send(JSON.stringify({ id: frame.id, result: {} }));
              setImmediate(() => socket.send(JSON.stringify({ method: 'turn/completed',
                params: { threadId, turn: { id: turnId, status: 'interrupted' } } })));
            } else {
              socket.send(JSON.stringify({ id: frame.id, result: {} }));
            }
          });
        });
        const address = server.address();
        if (!address || typeof address === 'string') throw Error('No cross-host test port');
        const store = new QuotaGuardSettingStore(dirs[hostId]);
        if (hostId === '6v') await store.setEnabled(true, 0);
        else store.writeMirrorSync(true, 1, Date.now());
        const peerHost = hostId === '6v' ? 'noha' : '6v';
        const peerNow = Date.now();
        store.writePeerRuntimeSync(runtimeFor(peerHost, { now: peerNow }), peerHost, peerNow);
        const guard = new QuotaGuardService(dirs[hostId],
          'ws://127.0.0.1:' + address.port, hostId, {
            pollMs: 60_000, peerPollMs: 20, retryDelaysMs: [20, 40, 80],
          });
        guards[hostId] = guard;
        guard.start();
        setLowCallbacks[hostId] = (value: boolean) => {
            low = value;
            if (value) {
              for (const socket of socketSets[hostId]) {
                socket.send(JSON.stringify({ method: 'account/rateLimits/updated',
                  params: { rateLimits: { limitId: 'codex', limitName: 'Codex',
                    primary: nativeWindow(98, 300, 1_800_000_000), secondary: null } } }));
              }
            }
          };
      }
      const lowGuard = guards[direction.lowHost]!;
      const activeGuard = guards[direction.activeHost]!;
      await waitFor(() => activeGuard.status().lastReadAt !== null &&
        lowGuard.status().lastReadAt !== null, 'healthy cross-host startup');
      assert.equal(activeGuard.admission().allowed, true);

      const threadId = direction.activeHost === '6v'
        ? '019b0000-0000-7000-8000-000000000041'
        : '019b0000-0000-7000-8000-000000000051';
      const turnId = direction.activeHost === '6v'
        ? '019b0000-0000-7000-8000-000000000042'
        : '019b0000-0000-7000-8000-000000000052';
      for (const socket of socketSets[direction.activeHost]) {
        socket.send(JSON.stringify({ method: 'turn/started',
          params: { threadId, turn: { id: turnId } } }));
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(interruptCalls[direction.activeHost].length, 0,
        'the active turn remains healthy before the peer low');

      setLowCallbacks[direction.lowHost]?.(true);
      await waitFor(() => lowGuard.status().triggers.length > 0, 'source host low latch');
      const targetStore = new QuotaGuardSettingStore(dirs[direction.activeHost]);
      handleQuotaGuardPeerSync(targetStore, {
        action: 'sync', enabled: true, revision: 1, updatedAt: Date.now(),
        runtime: lowGuard.status(),
      }, direction.lowHost, direction.activeHost);
      await waitFor(() => interruptCalls[direction.activeHost].length > 0,
        direction.lowHost + ' low interrupting ' + direction.activeHost);
      assert.deepEqual(interruptCalls[direction.activeHost][0], { threadId, turnId });
      assert.equal(activeGuard.admission().reason, 'QUOTA_GUARD_PEER_BLOCKED');
      await waitFor(() => activeGuard.status().interrupts.some((item) =>
        item.turnId === turnId && item.state === 'confirmed'), 'cross-host terminal confirmation');
    } finally {
      for (const guard of Object.values(guards)) guard?.close();
      for (const hostId of ['6v', 'noha'] as const) {
        const server = servers[hostId];
        if (!server) continue;
        for (const socket of socketSets[hostId]) socket.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      rmSync(dirs['6v'], { recursive: true, force: true });
      rmSync(dirs.noha, { recursive: true, force: true });
    }
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
    const peerNow = Date.now();
    store.writePeerRuntimeSync(runtimeFor('noha', { now: peerNow }), 'noha', peerNow);
    const guard = new QuotaGuardService(directory, 'ws://127.0.0.1:' + address.port,
      '6v', { pollMs: 60_000, maxReadAgeMs: 120_000,
        retryDelaysMs: [20, 20, 20] });
    try {
      guard.start();
      await waitFor(() => guard.status().interrupts.some((item) =>
        item.turnId === turnId && item.state === 'failed'), 'bounded interrupt failure');
      assert.equal(interrupts, 3);
      assert.equal(guard.status().interrupts.find((item) => item.turnId === turnId)?.reason,
        'NATIVE_RPC_FAILED');
      assert.equal(guard.status().triggers.length, 1);
      assert.equal(guard.admission().reason, 'QUOTA_GUARD_BLOCKED');
      for (const socket of sockets) socket.send(JSON.stringify({ method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'interrupted' } } }));
      await waitFor(() => guard.status().interrupts.some((item) =>
        item.turnId === turnId && item.state === 'confirmed'), 'late terminal event repairs failure');
      assert.equal(guard.admission().reason, 'QUOTA_GUARD_BLOCKED');
    } finally { guard.close(); }
  } finally {
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('persisted interrupt failures reconcile exact paginated terminal turns without clearing unknowns', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-guard-reconcile-'));
  const threadId = '019b0000-0000-7000-8000-000000000031';
  const turnId = '019b0000-0000-7000-8000-000000000032';
  const missingId = '019b0000-0000-7000-8000-000000000033';
  const activeId = '019b0000-0000-7000-8000-000000000034';
  let activeStatus = 'inProgress';
  let interrupts = 0;
  let historyReads = 0;
  const native = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    native.once('listening', resolve);
    native.once('error', reject);
  });
  native.on('connection', (socket) => socket.on('message', (bytes) => {
    const frame = JSON.parse(bytes.toString()) as {
      id?: number; method?: string; params?: Record<string, unknown>;
    };
    if (!frame.id || !frame.method) return;
    let result: unknown = {};
    if (frame.method === 'account/rateLimits/read') result = snapshot({ codex: {
      limitId: 'codex', primary: nativeWindow(99, 300), secondary: null,
    } });
    else if (frame.method === 'thread/loaded/list') result = { data: [], nextCursor: null };
    else if (frame.method === 'thread/turns/list') {
      historyReads++;
      assert.equal(frame.params?.threadId, threadId);
      result = frame.params?.cursor === 'older'
        ? { data: [{ id: turnId, status: 'interrupted' }], nextCursor: null }
        : { data: [{ id: activeId, status: activeStatus }], nextCursor: 'older' };
    } else if (frame.method === 'turn/interrupt') {
      assert.equal(frame.params?.turnId, activeId);
      interrupts++;
      activeStatus = 'interrupted';
    }
    socket.send(JSON.stringify({ id: frame.id, result }));
  }));
  const address = native.address();
  if (!address || typeof address === 'string') throw Error('No native test port');
  try {
    const store = new QuotaGuardSettingStore(directory);
    await store.setEnabled(true, 0);
    const now = Date.now();
    store.writeRuntimeSync({ ...runtimeFor('6v', { now }), enabled: true,
      interrupts: [turnId, missingId, activeId].map((id) => ({ threadId, turnId: id,
        state: 'failed' as const, attempts: 3, requestedAt: now, confirmedAt: null,
        reason: 'NATIVE_OFFLINE' })) });
    store.writePeerRuntimeSync(runtimeFor('noha', { now }), 'noha', now);
    const guard = new QuotaGuardService(directory, 'ws://127.0.0.1:' + address.port,
      '6v', { pollMs: 100, retryDelaysMs: [500, 500, 500] });
    try {
      guard.start();
      const state = (id: string) => guard.status().interrupts.find((item) => item.turnId === id)?.state;
      await waitFor(() => state(turnId) === 'confirmed', 'persisted terminal history');
      await waitFor(() => state(activeId) === 'confirmed', 'active turn retry and polling reconciliation');
      assert.equal(state(missingId), 'failed', 'missing history does not prove termination');
      assert.equal(interrupts, 1, 'only a verified active turn is retried');
      assert.ok(historyReads >= 4, 'reads additional pages and periodically reconciles');
      assert.equal(guard.admission().reason, 'QUOTA_GUARD_BLOCKED');
    } finally { guard.close(); }
  } finally {
    for (const socket of native.clients) socket.terminate();
    await new Promise<void>((resolve) => native.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
