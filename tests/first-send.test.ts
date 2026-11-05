import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingSelection, pendingDraftKey, sendFirstTurn } from '../src/session/firstSend';

test('local new selection creates no RPC; first send starts one project thread then turn', async () => {
  const pending = createPendingSelection('project-id', 'C:\\Work\\Repo');
  assert.match(pendingDraftKey(pending), /^pending:\d{13}-[a-f0-9]{24}$/);
  const methods: string[] = [];
  let created = '';
  await sendFirstTurn({
    async request(method, params) {
      methods.push(method);
      if (method === 'thread/start') {
        assert.deepEqual(params, { cwd: 'C:\\Work\\Repo', projectId: 'project-id' });
        return { thread: { id: 'real-thread' } };
      }
      assert.equal(method, 'turn/start');
      assert.equal(params.threadId, 'real-thread');
      return { turn: { id: 'turn-one' } };
    },
  }, pending, 'Hello', async (thread) => {
    created = thread.id;
    methods.push('save-id');
  });
  assert.equal(created, 'real-thread');
  assert.deepEqual(methods, ['thread/start', 'save-id', 'turn/start']);
});

test('projectless first send prepares a native workspace before creating a thread', async () => {
  const pending = createPendingSelection(null, null);
  const seen: string[] = [];
  await sendFirstTurn({
    async request(method, params) {
      seen.push(method);
      if (method === 'workspace/prepare') {
        assert.equal(params.draftId, pending.id);
        return { cwd: 'C:\\Users\\Sample\\Documents\\Codex\\MobileUI\\2026-11-05\\abc' };
      }
      if (method === 'thread/start') {
        assert.equal(params.cwd, 'C:\\Users\\Sample\\Documents\\Codex\\MobileUI\\2026-11-05\\abc');
        assert.equal(params.projectId, undefined);
        assert.equal(params.sandbox, 'workspace-write');
        assert.equal(params.approvalPolicy, 'on-request');
        return { thread: { id: 'thread' } };
      }
      return { turn: { id: 'turn' } };
    },
  }, pending, 'Hello', async () => undefined);
  assert.deepEqual(seen, ['workspace/prepare', 'thread/start', 'turn/start']);
});

test('failure after thread creation retains the real ID and never starts a second thread', async () => {
  const methods: string[] = [];
  let created = '';
  await assert.rejects(sendFirstTurn({
    async request(method) {
      methods.push(method);
      if (method === 'thread/start') return { thread: { id: 'saved' } };
      throw new Error('turn failed');
    },
  }, createPendingSelection('project', 'C:\\Work'), 'content',
  async (thread) => { created = thread.id; }), /turn failed/);
  assert.equal(created, 'saved');
  assert.deepEqual(methods, ['thread/start', 'turn/start']);
});

test('workspace failure prevents all thread creation', async () => {
  const methods: string[] = [];
  await assert.rejects(sendFirstTurn({
    async request(method) {
      methods.push(method);
      return { cwd: '../invalid' };
    },
  }, createPendingSelection(null, null), 'first', async () => {
    assert.fail('no thread should be created');
  }), /没有确认/);
  assert.deepEqual(methods, ['workspace/prepare']);
});
