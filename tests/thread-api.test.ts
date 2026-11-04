import test from 'node:test';
import assert from 'node:assert/strict';
import {
  includeLiveThreads, listAllThreads, parseThreadPage, startLiveThread, type ThreadRpcClient,
} from '../src/core/threadApi';
import type { JsonObject } from '../src/core/protocol';

test('listAllThreads follows native pagination, deduplicates IDs, and retains ordering', async () => {
  const calls: JsonObject[] = [];
  const client: ThreadRpcClient = {
    async request(method, params) {
      assert.equal(method, 'thread/list');
      calls.push(params);
      if (!params.cursor) return { data: [
        { id: 'recent', cwd: 'C:\\Code\\Repo', updatedAt: 5 },
        { id: 'shared', cwd: 'C:\\Code\\Repo', updatedAt: 4 },
      ], nextCursor: 'page2' };
      assert.equal(params.cursor, 'page2');
      return { data: [
        { id: 'shared', cwd: 'C:\\Code\\Repo', updatedAt: 3 },
        { id: 'older', cwd: 'C:\\Code\\Other', updatedAt: 1 },
      ], nextCursor: null };
    },
  };
  const all = await listAllThreads(client);
  assert.deepEqual(all.map((thread) => thread.id), ['recent', 'shared', 'older']);
  assert.equal(all[1].updatedAt, 4, 'keep the first, most recent version');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { limit: 100, sortKey: 'recency_at', modelProviders: [] });
});

test('new live thread is selectable before persistence without resume/read', async () => {
  const calls: string[] = [];
  const client: ThreadRpcClient = {
    async request(method, params) {
      calls.push(method);
      assert.equal(method, 'thread/start');
      assert.deepEqual(params, { cwd: 'C:\\Code\\Repo' });
      return { thread: { id: 'live-1', title: null } };
    },
  };
  const created = await startLiveThread(client, 'C:\\Code\\Repo');
  assert.equal(created.id, 'live-1');
  assert.equal(created.cwd, 'C:\\Code\\Repo');
  assert.deepEqual(calls, ['thread/start']);

  const pending = new Map([[created.id, created]]);
  assert.deepEqual(includeLiveThreads([{ id: 'old', name: null, cwd: null, updatedAt: 1 }], pending)
    .map((t) => t.id), ['live-1', 'old']);
  assert.deepEqual(includeLiveThreads([created], pending).map((t) => t.id), ['live-1']);
});

test('malformed or looping pages fail rather than overwriting cached history', async () => {
  assert.throws(() => parseThreadPage({ data: [], nextCursor: 7 }), /invalid cursor/);
  const looping: ThreadRpcClient = {
    async request() { return { data: [], nextCursor: 'repeat' }; },
  };
  await assert.rejects(listAllThreads(looping), /repeated its pagination cursor/);
  await assert.rejects(listAllThreads({
    async request() { return { items: [], nextCursor: null }; },
  }), /unrecognized result/);
});
