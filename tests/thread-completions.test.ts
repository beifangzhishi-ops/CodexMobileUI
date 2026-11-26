import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
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
  } = {},
): Promise<Response> {
  return new Promise((resolveRequest, reject) => {
    const headers: Record<string, string> = { Host: options.host ?? expectedHost };
    if (options.origin !== null) headers.Origin = options.origin ?? expectedOrigin;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/thread-completions',
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
      peerUrl: 'ws://100.96.30.32:4191/peer',
    }));
    await writeFile(resolve(fixture, '.state/web-peer-token'), 'a'.repeat(64));
    await writeFile(resolve(fixture, '.state/sidebar-pins-primary'), '6v');
    await writeFile(preload, [
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

    let started = await startCoordinator(fixture, readyFile, preload);
    coordinator = started.process;
    const initial = await request(started.port);
    assert.equal(initial.status, 200);
    assert.deepEqual(JSON.parse(initial.body), { revision: 0, items: [] });

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
    await rm(fixture, { recursive: true, force: true });
  }
});
