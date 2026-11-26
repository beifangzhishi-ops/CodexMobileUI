import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { ThreadCompletionStore } from '../gateway/threadCompletions';
import { handleThreadCompletionsHttp } from '../gateway/threadCompletionsHttp';

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

test('Coordinator completion route persists by host/thread and rejects a bad Origin', async () => {
  const directory = resolve('.tmp', 'thread-completions-http-' + randomUUID());
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'sidebar-pins-primary'), '6v');
  const store = new ThreadCompletionStore(directory);
  let expectedOrigin = '';
  const server = createServer((req, res) => {
    void handleThreadCompletionsHttp(req, res, store, expectedOrigin);
  });
  await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server unavailable');
  const origin = 'http://127.0.0.1:' + address.port;
  expectedOrigin = origin;
  const thread = { hostId: '6v', threadId: 'thread-http-1' };
  try {
    const valid = await fetch(origin + '/api/thread-completions', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread, completed: true }),
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { revision: 1, items: [thread] });
    const list = await fetch(origin + '/api/thread-completions');
    assert.deepEqual(await list.json(), { revision: 1, items: [thread] });
    const rejected = await fetch(origin + '/api/thread-completions', {
      method: 'POST',
      headers: { Origin: 'https://wrong.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread: { hostId: 'noha', threadId: 'thread-http-2' }, completed: true }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await store.list(), { revision: 1, items: [thread] });
  } finally {
    await new Promise<void>((resolveServer, reject) =>
      server.close((error) => error ? reject(error) : resolveServer()));
    await rm(directory, { recursive: true, force: true });
  }
});
