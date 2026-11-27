import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { ThreadCompletionStore } from '../gateway/threadCompletions';

const expectedOrigin = 'https://node.example.ts.net:4190';
const expectedHost = 'node.example.ts.net:4190';

type CoordinatorProcess = {
  child: ChildProcessWithoutNullStreams;
  output: () => string;
};

type Response = { status: number; body: string };

function pause(ms: number): Promise<void> {
  return new Promise((resolvePause) => setTimeout(resolvePause, ms));
}

async function startCoordinator(
  fixture: string,
  readyFile: string,
  preload: string,
): Promise<{ process: CoordinatorProcess; port: number }> {
  await rm(readyFile, { force: true });
  const child = spawn(process.execPath, [
    '--require', preload,
    resolve(fixture, 'web/server/bridge.mjs'),
    'coordinator',
  ], {
    cwd: fixture,
    env: { ...process.env, CODEX_WEB_TEST_READY_FILE: readyFile },
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const coordinator = {
    child,
    output: () => stdout + stderr,
  };
  for (let attempt = 0; attempt < 200; attempt++) {
    if (existsSync(readyFile)) {
      const ready = JSON.parse(await readFile(readyFile, 'utf8')) as { port?: unknown };
      if (!Number.isSafeInteger(ready.port)) throw Error('Coordinator reported an invalid port');
      return { process: coordinator, port: ready.port as number };
    }
    if (child.exitCode !== null) {
      throw Error('Isolated Coordinator exited before becoming ready:\n' + coordinator.output());
    }
    await pause(25);
  }
  child.kill();
  throw Error('Isolated Coordinator did not become ready:\n' + coordinator.output());
}

async function stopCoordinator(coordinator: CoordinatorProcess): Promise<void> {
  if (coordinator.child.exitCode !== null) return;
  coordinator.child.kill();
  await Promise.race([
    new Promise<void>((resolveExit) => coordinator.child.once('exit', () => resolveExit())),
    pause(3000),
  ]);
  if (coordinator.child.exitCode === null) coordinator.child.kill('SIGKILL');
}

async function request(
  port: number,
  options: {
    method?: string;
    origin?: string | null;
    body?: string;
    host?: string;
    path?: string;
    range?: string;
  } = {},
): Promise<Response> {
  return new Promise((resolveRequest, reject) => {
    const headers: Record<string, string> = { Host: options.host ?? expectedHost };
    if (options.origin !== null) headers.Origin = options.origin ?? expectedOrigin;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.range) headers.Range = options.range;
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: options.path ?? '/api/thread-completions',
      method: options.method ?? 'GET',
      headers,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolveRequest({
        status: response.statusCode ?? 0,
        body,
      }));
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

test('6v owns bounded revisioned thread completion state with atomic concurrent writes', async () => {
  const directory = resolve('.tmp', 'thread-completions-test-' + randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const storeA = new ThreadCompletionStore(directory);
    const storeB = new ThreadCompletionStore(directory);
    await assert.rejects(storeA.list(), /COMPLETIONS_PRIMARY_UNAVAILABLE/);
    await writeFile(resolve(directory, 'sidebar-pins-primary'), '6v');
    const first = { hostId: '6v' as const, threadId: 'thread-1' };
    const second = { hostId: 'noha' as const, threadId: 'thread-2' };
    await Promise.all([storeA.set(first, true), storeB.set(second, true)]);
    const initial = await storeA.list();
    assert.equal(initial.revision, 2);
    assert.equal(initial.items.length, 2);
    assert.equal((await storeB.set(first, true)).revision, 2);
    const cleared = await storeB.set(second, false);
    assert.deepEqual(cleared, { revision: 3, items: [first] });
    await assert.rejects(storeA.set({ ...first, hostId: 'other' }, true), /COMPLETIONS_INVALID_PARAMS/);
    await assert.rejects(storeA.set(first, 'yes'), /COMPLETIONS_INVALID_PARAMS/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('real Coordinator bridge scopes completion state by host across restart', async () => {
  const fixture = resolve('.tmp', 'thread-completions-bridge-' + randomUUID());
  const readyFile = resolve(fixture, 'ready.json');
  const preload = resolve(fixture, 'bind-ephemeral.cjs');
  let coordinator: CoordinatorProcess | undefined;
  let peerServer: WebSocketServer | undefined;
  let nativeServer: WebSocketServer | undefined;
  const priorPeerPort = process.env.CODEX_WEB_TEST_PEER_PORT;
  const priorNativePort = process.env.CODEX_WEB_TEST_NATIVE_PORT;
  try {
    await mkdir(resolve(fixture, '.state'), { recursive: true });
    await cp(resolve('.tmp/testdist/gateway'), resolve(fixture, 'dist/gateway'), { recursive: true });
    await cp(resolve('.tmp/testdist/shared'), resolve(fixture, 'dist/shared'), { recursive: true });
    await cp(resolve('web/server'), resolve(fixture, 'web/server'), { recursive: true });
    await cp(resolve('node_modules/ws'), resolve(fixture, 'node_modules/ws'), { recursive: true });

    // The production bridge watches native App Servers. Keep this HTTP-route
    // integration test independent of any live host process.
    await writeFile(resolve(fixture, 'web/server/notificationFeed.mjs'), [
      'export class NotificationFeed { subscribe() {} }',
      'export function watchNativeCompletions() {}',
      '',
    ].join('\n'));
    await writeFile(resolve(fixture, '.state/web-bridge.json'), JSON.stringify({
      origin: expectedOrigin,
      peers: [
        { id: 'noha', displayName: 'noha host', peerUrl: 'ws://100.96.30.32:4191/peer' },
        { id: 'test-peer', displayName: 'Test peer', peerUrl: 'ws://100.96.30.33:4191/peer' },
      ],
    }));
    await writeFile(resolve(fixture, '.state/web-peer-noha.token'), 'b'.repeat(64));
    await writeFile(resolve(fixture, '.state/web-peer-test-peer.token'), 'c'.repeat(64));
    await writeFile(resolve(fixture, '.state/sidebar-pins-primary'), '6v');
    const mockPeerServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    peerServer = mockPeerServer;
    await new Promise<void>((resolveListen) => mockPeerServer.once('listening', resolveListen));
    const peerAddress = mockPeerServer.address();
    if (!peerAddress || typeof peerAddress === 'string') throw Error('Mock peer did not bind');
    const hostBytes = new Map([
      ['b'.repeat(64), Buffer.from('legacy noha publication')],
      ['c'.repeat(64), Buffer.from('additional peer publication')],
    ]);
    mockPeerServer.on('connection', (socket, requestMessage) => {
      const bytes = hostBytes.get(String(requestMessage.headers.authorization ?? '').slice('Bearer '.length));
      if (requestMessage.url !== '/peer' || !bytes) {
        socket.close(); return;
      }
      socket.send(JSON.stringify({ type: 'ready' }));
      socket.on('message', (frame) => {
        const message = JSON.parse(String(frame)) as { id: number; method: string; params: { method: string; params: { offset?: number } } };
        if (message.method !== 'web/publication') return;
        const result = message.params.method === 'workspace/publication/publish'
          ? { hostId: bytes[0] === 108 ? 'noha' : 'test-peer', id: 'd'.repeat(64) }
          : message.params.method === 'workspace/publication/stat'
          ? { id: 'd'.repeat(64), name: 'remote.txt', mime: 'text/plain', size: bytes.length, status: 'ready', previewKind: 'text' }
          : { data: bytes.subarray(message.params.params.offset ?? 0).toString('base64'), received: bytes.length };
        socket.send(JSON.stringify({ id: message.id, result }));
      });
    });
    const mockNativeServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    nativeServer = mockNativeServer;
    await new Promise<void>((resolveListen) => mockNativeServer.once('listening', resolveListen));
    const nativeAddress = mockNativeServer.address();
    if (!nativeAddress || typeof nativeAddress === 'string') throw Error('Mock native server did not bind');
    mockNativeServer.on('connection', (socket) => {
      socket.on('message', (frame) => {
        const message = JSON.parse(String(frame)) as { id?: number; method?: string; type?: string };
        if (message.type === 'connect') socket.send(JSON.stringify({ type: 'ready' }));
        else if (message.method === 'initialize') socket.send(JSON.stringify({
          id: message.id, result: { servedBy: '6v-local-native' },
        }));
      });
    });
    await writeFile(preload, [
      "const net = require('node:net');",
      'const originalConnect = net.connect;',
      'net.connect = function (...args) {',
      '  const options = args[0];',
      '  if (options && typeof options === "object" && /^100\\./.test(options.host || "") && options.port === 4191) {',
      '    args[0] = { ...options, host: "127.0.0.1", port: Number(process.env.CODEX_WEB_TEST_PEER_PORT) };',
      '  }',
      '  return originalConnect.apply(this, args);',
      '};',
      "const httpClient = require('node:http');",
      'const originalRequest = httpClient.request;',
      'httpClient.request = function (...args) {',
      '  const options = args[0];',
      '  if (options && typeof options === "object" && /^100\\./.test(options.hostname || options.host || "") && Number(options.port || 80) === 4191) {',
      '    args[0] = { ...options, hostname: "127.0.0.1", host: undefined, port: Number(process.env.CODEX_WEB_TEST_PEER_PORT) };',
      '  }',
      '  if (options && typeof options === "object" && (options.hostname || options.host) === "127.0.0.1" && Number(options.port) === 45891) {',
      '    args[0] = { ...options, port: Number(process.env.CODEX_WEB_TEST_NATIVE_PORT) };',
      '  }',
      '  return originalRequest.apply(this, args);',
      '};',
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      'const originalListen = http.Server.prototype.listen;',
      'http.Server.prototype.listen = function (...args) {',
      '  if (args[0] !== 4190) return originalListen.apply(this, args);',
      '  args[0] = 0;',
      '  this.once("listening", () => {',
      '    const address = this.address();',
      '    fs.writeFileSync(process.env.CODEX_WEB_TEST_READY_FILE,',
      '      JSON.stringify({ port: address.port }), "utf8");',
      '  });',
      '  return originalListen.apply(this, args);',
      '};',
      '',
    ].join('\n'));
    process.env.CODEX_WEB_TEST_PEER_PORT = String(peerAddress.port);
    process.env.CODEX_WEB_TEST_NATIVE_PORT = String(nativeAddress.port);

    let started = await startCoordinator(fixture, readyFile, preload);
    coordinator = started.process;
    const initial = await request(started.port);
    assert.equal(initial.status, 200);
    assert.deepEqual(JSON.parse(initial.body), { revision: 0, items: [] });

    const publicRoster = await request(started.port, { path: '/api/hosts' });
    assert.equal(publicRoster.status, 200);
    assert.deepEqual(JSON.parse(publicRoster.body), {
      primaryHostId: '6v',
      hosts: [
        { id: '6v', displayName: '6v' },
        { id: 'noha', displayName: 'noha host' },
        { id: 'test-peer', displayName: 'Test peer' },
      ],
    });
    assert.equal(publicRoster.body.includes('bbbbbbbb'), false);
    assert.equal(publicRoster.body.includes('100.96.'), false);

    const unknownPublication = await request(started.port, {
      path: '/api/publication?host=unknown&id=' + 'd'.repeat(64) + '&mode=download',
    });
    assert.equal(unknownPublication.status, 400);
    const remoteRange = await request(started.port, {
      path: '/api/publication?host=noha&id=' + 'd'.repeat(64) + '&mode=download',
      range: 'bytes=7-17',
    });
    assert.equal(remoteRange.status, 206, coordinator.output());
    assert.equal(remoteRange.body, 'noha public');
    const extraRange = await request(started.port, {
      path: '/api/publication?host=test-peer&id=' + 'd'.repeat(64) + '&mode=download',
      range: 'bytes=0-9',
    });
    assert.equal(extraRange.status, 206);
    assert.equal(extraRange.body, 'additional');

    const browserRpc = (hostId: string, method: string, params: object) => new Promise<unknown>((resolveRpc, rejectRpc) => {
      const socket = new WebSocket('ws://127.0.0.1:' + started.port + '/api/connect?host=' + hostId, {
        headers: { Host: expectedHost, Origin: expectedOrigin },
      });
      const timer = setTimeout(() => { socket.close(); rejectRpc(Error('Browser relay timed out')); }, 3000);
      socket.on('message', (frame) => {
        const message = JSON.parse(String(frame)) as { type?: string; id?: number; result?: unknown };
        if (message.type === 'ready') socket.send(JSON.stringify({ id: 7, method, params }));
        else if (message.id === 7) {
          clearTimeout(timer);
          socket.close();
          resolveRpc(message);
        }
      });
      socket.on('error', (error) => { clearTimeout(timer); rejectRpc(error); });
    });
    assert.deepEqual(await browserRpc('6v', 'initialize', {
      clientInfo: { name: 'codex_multi_host_web', version: '0.1.0' },
    }), { id: 7, result: { servedBy: '6v-local-native' } });
    assert.deepEqual(await browserRpc('noha', 'web/publication', {
      method: 'workspace/publication/publish', params: {
        threadId: '123e4567-e89b-12d3-a456-426614174000', itemId: 'item-1', linkIndex: 0,
      },
    }), { id: 7, result: { hostId: 'noha', id: 'd'.repeat(64) } });
    assert.deepEqual(await browserRpc('test-peer', 'web/publication', {
      method: 'workspace/publication/publish', params: {
        threadId: '123e4567-e89b-12d3-a456-426614174000', itemId: 'item-1', linkIndex: 0,
      },
    }), { id: 7, result: { hostId: 'test-peer', id: 'd'.repeat(64) } });

    const set = (hostId: '6v' | 'noha', completed: boolean, origin = expectedOrigin) => request(
      started.port,
      {
        method: 'POST',
        origin,
        body: JSON.stringify({ thread: { hostId, threadId: 'shared-thread' }, completed }),
      },
    );

    const bothHosts = await set('6v', true);
    assert.equal(bothHosts.status, 200);
    assert.deepEqual(JSON.parse(bothHosts.body), {
      revision: 1,
      items: [{ hostId: '6v', threadId: 'shared-thread' }],
    });
    const noha = await set('noha', true);
    assert.equal(noha.status, 200);
    assert.deepEqual(JSON.parse(noha.body), {
      revision: 2,
      items: [
        { hostId: '6v', threadId: 'shared-thread' },
        { hostId: 'noha', threadId: 'shared-thread' },
      ],
    });
    const clearPrimary = await set('6v', false);
    assert.deepEqual(JSON.parse(clearPrimary.body), {
      revision: 3,
      items: [{ hostId: 'noha', threadId: 'shared-thread' }],
    });
    const clearNoha = await set('noha', false);
    assert.deepEqual(JSON.parse(clearNoha.body), { revision: 4, items: [] });

    const restored = await set('noha', true);
    assert.equal(restored.status, 200);
    const crossOrigin = await set('6v', true, 'https://wrong.example');
    assert.equal(crossOrigin.status, 400);
    const wrongHost = await request(started.port, { host: 'wrong.example:4190' });
    assert.equal(wrongHost.status, 403);
    const beforeRestart = await request(started.port);
    assert.deepEqual(JSON.parse(beforeRestart.body), {
      revision: 5,
      items: [{ hostId: 'noha', threadId: 'shared-thread' }],
    });

    await stopCoordinator(coordinator);
    coordinator = undefined;
    started = await startCoordinator(fixture, readyFile, preload);
    coordinator = started.process;
    const afterRestart = await request(started.port);
    assert.equal(afterRestart.status, 200);
    assert.deepEqual(JSON.parse(afterRestart.body), {
      revision: 5,
      items: [{ hostId: 'noha', threadId: 'shared-thread' }],
    });
  } finally {
    if (coordinator) await stopCoordinator(coordinator);
    if (peerServer) await new Promise<void>((resolveClose) => peerServer!.close(() => resolveClose()));
    if (nativeServer) await new Promise<void>((resolveClose) => nativeServer!.close(() => resolveClose()));
    if (priorPeerPort === undefined) delete process.env.CODEX_WEB_TEST_PEER_PORT;
    else process.env.CODEX_WEB_TEST_PEER_PORT = priorPeerPort;
    if (priorNativePort === undefined) delete process.env.CODEX_WEB_TEST_NATIVE_PORT;
    else process.env.CODEX_WEB_TEST_NATIVE_PORT = priorNativePort;
    await rm(fixture, { recursive: true, force: true });
  }
});
