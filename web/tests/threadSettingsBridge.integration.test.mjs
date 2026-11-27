import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'https://node.example.ts.net:4190';
const threadId = '01a218cc-2c0e-7393-bb6a-bf4d152c0af1';

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => server.listen(0, '127.0.0.1', resolveListen).once('error', reject));
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForReady(child, file) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')).port;
    if (child.exitCode !== null) throw Error('Bridge exited before ready: ' + child.output());
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw Error('Bridge readiness timed out: ' + child.output());
}

function startBridge(fixture, mode, port, readyPath, preload, agentPort = 0, nativePort) {
  const child = spawn(process.execPath, ['--require', preload,
    resolve(fixture, 'web/server/bridge.mjs'), mode], {
    cwd: fixture, windowsHide: true,
    env: { ...process.env,
      CODEX_BRIDGE_TEST_LISTEN_PORT: String(mode === 'coordinator' ? 4190 : 4191),
      CODEX_BRIDGE_TEST_ACTUAL_PORT: String(port),
      CODEX_BRIDGE_TEST_READY_FILE: readyPath,
      CODEX_BRIDGE_TEST_AGENT_PORT: String(agentPort),
      CODEX_BRIDGE_TEST_NATIVE_PORT: String(nativePort),
    },
  });
  let output = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.output = () => output;
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function openBridge(port, hostId) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/connect?host=${hostId}`, {
    headers: { Host: 'node.example.ts.net:4190', Origin: origin },
  });
  await new Promise((resolveOpen, reject) => {
    socket.once('open', resolveOpen); socket.once('error', reject);
  });
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(Error('Coordinator/Agent never became ready')), 5000);
    const listener = (frame) => {
      const message = JSON.parse(String(frame));
      if (message.type === 'ready') { clearTimeout(timer); socket.off('message', listener); resolveReady(message); }
    };
    socket.on('message', listener); socket.once('error', reject);
  });
  assert.deepEqual(ready, { type: 'ready' });
  return socket;
}

function call(socket, id, method, params) {
  return new Promise((resolveCall, reject) => {
    const timer = setTimeout(() => reject(Error(`RPC timeout: ${method}`)), 7000);
    const listener = (frame) => {
      const message = JSON.parse(String(frame));
      if (message.id !== id) return;
      clearTimeout(timer); socket.off('message', listener); resolveCall(message);
    };
    socket.on('message', listener);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

test('isolated Coordinator and peer Agent validate thread settings against native fixtures', async (t) => {
  const fixture = resolve(repo, '.tmp', 'thread-settings-bridge-' + randomUUID());
  const state = resolve(fixture, '.state');
  const agentState = resolve(fixture, 'web/.state');
  await mkdir(state, { recursive: true });
  await mkdir(agentState, { recursive: true });
  await cp(resolve(repo, 'dist/gateway'), resolve(fixture, 'dist/gateway'), { recursive: true });
  await cp(resolve(repo, 'dist/shared'), resolve(fixture, 'dist/shared'), { recursive: true });
  await cp(resolve(repo, 'web/server'), resolve(fixture, 'web/server'), { recursive: true });
  await cp(resolve(repo, 'node_modules/ws'), resolve(fixture, 'node_modules/ws'), { recursive: true });
  await cp(resolve(fixture, 'dist'), resolve(fixture, 'web/dist'), { recursive: true });
  await cp(resolve(fixture, 'node_modules/ws'), resolve(fixture, 'web/node_modules/ws'), { recursive: true });

  const localNativePort = await freePort();
  const peerNativePort = await freePort();
  const coordinatorPort = await freePort();
  const agentPort = await freePort();
  const hostFixtures = [
    { hostId: '6v', port: localNativePort, threadId,
      cwd: 'C:\\fixture-6v', calls: [], defaults: {
        activePermissionProfile: { id: ':workspace' },
        sandbox: { type: 'workspaceWrite', writableRoots: ['C:\\fixture-6v'] },
        approvalPolicy: 'on-request', approvalsReviewer: 'user',
      } },
    { hostId: 'noha', port: peerNativePort, threadId: '01a218cc-2c0e-7393-bb6a-bf4d152c0af2',
      cwd: 'C:\\fixture-noha', calls: [], defaults: {
        activePermissionProfile: { id: ':workspace' },
        sandbox: { type: 'workspaceWrite', writableRoots: ['C:\\fixture-noha'] },
        approvalPolicy: 'on-request', approvalsReviewer: 'user',
      } },
  ];
  const nativeServers = hostFixtures.map((host) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: host.port });
    server.on('connection', (socket, request) => {
      if (request.url.startsWith('/connect?')) {
        let initialized = false;
        let initializeSeen = false;
        socket.on('message', (data) => {
          const message = JSON.parse(String(data));
          if (message.type === 'connect') {
            socket.send(JSON.stringify({ type: 'ready' }));
          } else if (message.method === 'initialize') {
            initializeSeen = message.params?.capabilities?.experimentalApi === true;
            socket.send(JSON.stringify({ id: message.id, result: {} }));
          } else if (message.method === 'initialized') {
            initialized = initializeSeen;
          } else if (['workspace/hostFileRead', 'workspace/hostFileWrite'].includes(message.method)) {
            const result = { kind: message.params.kind, text: host.hostId, initialized };
            const error = { code: -32602, message: 'NATIVE_NOT_INITIALIZED' };
            socket.send(JSON.stringify({ id: message.id, ...(
              message.params.kind === 'projectRules' && !initialized ? { error } : { result }
            ) }));
          }
        });
        return;
      }
      socket.send(JSON.stringify({ type: 'ready' }));
      socket.on('message', (data) => {
        const message = JSON.parse(String(data));
        if (typeof message.id !== 'number' || !message.method) return;
        host.calls.push(message);
        let result = {};
        let error;
        if (message.method === 'model/list') result = { data: [{
          id: 'gpt-6-luna', supportedReasoningEfforts: [
            { reasoningEffort: 'low' }, { reasoningEffort: 'medium' },
          ],
        }] };
        if (message.method === 'permissionProfile/list') result = { data: [
          { id: ':workspace', allowed: true }, { id: ':read-only', allowed: false },
        ] };
        if (message.method === 'thread/read') {
          if (message.params?.threadId !== host.threadId) error = { code: -32000, message: 'THREAD_NOT_FOUND' };
          else result = { thread: {
            id: host.threadId, cwd: host.cwd, turns: [{ status: 'completed' }],
          } };
        }
        if (message.method === 'thread/start') result = host.defaults;
        if (message.method === 'thread/resume') result = host.defaults;
        socket.send(JSON.stringify({ id: message.id, ...(error ? { error } : { result }) }));
      });
    });
    return server;
  });

  const preload = resolve(fixture, 'bind-fixture-ports.cjs');
  await writeFile(preload, [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    "const net = require('node:net');",
    'const originalListen = http.Server.prototype.listen;',
    'http.Server.prototype.listen = function (...args) {',
    '  if (args[0] === Number(process.env.CODEX_BRIDGE_TEST_LISTEN_PORT)) {',
    '    args[0] = Number(process.env.CODEX_BRIDGE_TEST_ACTUAL_PORT);',
    '    this.once("listening", () => fs.writeFileSync(process.env.CODEX_BRIDGE_TEST_READY_FILE,',
    '      JSON.stringify({ port: this.address().port }), "utf8"));',
    '  }',
    '  return originalListen.apply(this, args);',
    '};',
    'const originalConnect = net.connect;',
    'net.connect = function (...args) {',
    '  const index = args.findIndex((arg) => arg && typeof arg === "object" && !Array.isArray(arg));',
    '  if (index >= 0) {',
    '    const options = { ...args[index] };',
    '    if ([45891, 48889].includes(Number(options.port))) { options.port = Number(process.env.CODEX_BRIDGE_TEST_NATIVE_PORT); options.host = "127.0.0.1"; }',
    '    if (Number(options.port) === 4191 && Number(process.env.CODEX_BRIDGE_TEST_AGENT_PORT)) { options.port = Number(process.env.CODEX_BRIDGE_TEST_AGENT_PORT); options.host = "127.0.0.1"; }',
    '    args[index] = options;',
    '  }',
    '  return originalConnect.apply(this, args);',
    '};',
    '',
  ].join('\n'));
  const credential = 'a'.repeat(64);
  await writeFile(resolve(state, 'web-bridge.json'), JSON.stringify({
    origin, peerUrl: 'ws://100.96.30.32:4191/peer',
  }));
  await writeFile(resolve(state, 'web-peer-token'), credential);
  await writeFile(resolve(state, 'sidebar-pins-primary'), '6v');
  await writeFile(resolve(state, 'mobile-tailnet-hosts.json'), JSON.stringify([
    { name: '6v', url: 'http://100.76.74.124:48889' },
    { name: 'noha', url: 'http://100.96.30.32:48889' },
  ]));
  await writeFile(resolve(agentState, 'web-bridge.json'), JSON.stringify({
    origin, peerUrl: 'ws://100.96.30.32:4191/peer',
  }));
  await writeFile(resolve(agentState, 'web-peer-token'), credential);
  await cp(resolve(state, 'mobile-tailnet-hosts.json'), resolve(agentState, 'mobile-tailnet-hosts.json'));

  let coordinator;
  let agent;
  const sockets = [];
  try {
    const agentReady = resolve(fixture, 'agent-ready.json');
    agent = startBridge(fixture, 'agent', agentPort, agentReady, preload, 0, peerNativePort);
    await waitForReady(agent, agentReady);
    const coordinatorReady = resolve(fixture, 'coordinator-ready.json');
    coordinator = startBridge(fixture, 'coordinator', coordinatorPort, coordinatorReady, preload,
      agentPort, localNativePort);
    await waitForReady(coordinator, coordinatorReady);

    for (const hostId of ['6v', 'noha']) {
      const nativeHost = hostFixtures.find((host) => host.hostId === hostId);
      assert.ok(nativeHost);
      const socket = await openBridge(coordinatorPort, hostId);
      sockets.push(socket);
      let id = hostId === '6v' ? 101 : 201;
      const globalRules = await call(socket, id++, 'web/hostFile', {
        method: 'workspace/hostFileRead', params: { kind: 'globalRules' },
      });
      assert.deepEqual(globalRules.result, { kind: 'globalRules', text: hostId, initialized: false });
      const projectSelection = { kind: 'projectRules', projectId: 'fixture-project', rootIndex: 0 };
      const projectRules = await call(socket, id++, 'web/hostFile', {
        method: 'workspace/hostFileRead', params: projectSelection,
      });
      assert.deepEqual(projectRules.result, { kind: 'projectRules', text: hostId, initialized: true });
      const savedRules = await call(socket, id++, 'web/hostFile', {
        method: 'workspace/hostFileWrite', params: { ...projectSelection,
          text: '# fixture', revision: 'missing', filename: 'AGENTS.md' },
      });
      assert.deepEqual(savedRules.result, { kind: 'projectRules', text: hostId, initialized: true });
      const model = await call(socket, id++, 'thread/settings/update', {
        threadId: nativeHost.threadId, model: 'gpt-6-luna', effort: 'medium',
      });
      assert.deepEqual(model.result, {});
      const profile = await call(socket, id++, 'thread/settings/update', {
        threadId: nativeHost.threadId, permissions: ':workspace', approvalsReviewer: 'user',
      });
      assert.deepEqual(profile.result, {});
      const custom = await call(socket, id++, 'web/permissionFromConfig', { threadId: nativeHost.threadId });
      assert.deepEqual(custom.result, { profile: ':workspace', reviewer: 'user' });

      const invalidRaw = await call(socket, id++, 'thread/settings/update', {
        threadId: nativeHost.threadId, permissions: ':workspace', approvalsReviewer: 'user', sandboxPolicy: {},
      });
      assert.deepEqual(invalidRaw.error, { code: -32602, message: 'RPC_NOT_ALLOWED' });
      const unsupportedReviewer = await call(socket, id++, 'thread/settings/update', {
        threadId: nativeHost.threadId, permissions: ':workspace', approvalsReviewer: 'guardian_subagent',
      });
      assert.deepEqual(unsupportedReviewer.error, { code: -32602, message: 'RPC_NOT_ALLOWED' });
      const unsupportedEffort = await call(socket, id++, 'thread/settings/update', {
        threadId: nativeHost.threadId, model: 'gpt-6-luna', effort: 'ultra',
      });
      assert.deepEqual(unsupportedEffort.error, { code: -32602, message: 'MODEL_UPDATE_REJECTED' });
      const deniedProfile = await call(socket, id++, 'thread/settings/update', {
        threadId: nativeHost.threadId, permissions: ':read-only', approvalsReviewer: 'user',
      });
      assert.deepEqual(deniedProfile.error, { code: -32602, message: 'PERMISSION_UPDATE_REJECTED' });
    }

    for (const host of hostFixtures) {
      const customUpdates = host.calls.filter((item) => item.method === 'thread/settings/update' &&
        item.params.approvalPolicy === 'on-request');
      assert.deepEqual(customUpdates.map((item) => item.params), [{
        threadId: host.threadId, permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'user',
      }], `Custom update must stay on the ${host.hostId} native thread`);
      const starts = host.calls.filter((item) => item.method === 'thread/start');
      assert.deepEqual(starts.map((item) => item.params), [{ cwd: host.cwd, ephemeral: true }],
        'the effective config lookup is a native ephemeral start with no permission/model overrides');
      assert.equal(host.calls.filter((item) => item.method === 'thread/read' &&
        item.params.threadId === host.threadId).length, 1);
      assert.equal(host.calls.filter((item) => item.method === 'thread/read' &&
        item.params.threadId !== host.threadId).length, 0, 'host route must not read another host thread');
      assert.equal(host.calls.filter((item) => item.method === 'model/list').length, 2,
        'each host lists models for valid and unsupported effort choices');
      assert.equal(host.calls.filter((item) => item.method === 'permissionProfile/list').length, 2);
      assert.equal(host.calls.filter((item) => item.method === 'thread/resume').length, 1);
      const settingsThreads = host.calls.filter((item) => item.method === 'thread/settings/update')
        .map((item) => item.params.threadId);
      assert.ok(settingsThreads.every((id) => id === host.threadId), 'updates must stay on the host native thread');
    }
  } finally {
    for (const socket of sockets) socket.close();
    await stop(coordinator);
    await stop(agent);
    await Promise.all(nativeServers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
  }
});
