import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, applyNotice, reconcileObservedReasoning } from '../src/nativeProtocol.ts';
import { compactionBusy, compactionOutcome } from '../src/compaction.ts';
import {
  permissionFingerprint, resolveResumedPermission,
} from '../src/permissionPreference.ts';

test('reasoning summary and explicit display text remain separate and foldable by item', () => {
  const notice = (method, params) => ({ method, params: { turnId: 't', itemId: 'r', ...params } });
  let messages = applyNotice([], notice('item/reasoning/summaryTextDelta', { summaryIndex: 0, delta: 'Summary' }));
  messages = applyNotice(messages, notice('item/reasoning/textDelta', { contentIndex: 0, delta: 'Native ' }));
  messages = applyNotice(messages, notice('item/reasoning/textDelta', { contentIndex: 0, delta: 'display text' }));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, 'Summary');
  assert.equal(messages[0].reasoningText, 'Native display text');
  messages = applyNotice(messages, notice('item/completed', {
    item: { id: 'r', type: 'reasoning', summary: [], content: [] },
  }));
  assert.equal(messages[0].content, 'Summary');
  assert.equal(messages[0].reasoningText, 'Native display text');
  assert.equal(messages[0].complete, true);
  const snapshot = parseSnapshot({ thread: { id: 'p', turns: [{ id: 't', status: 'completed', items: [
    { id: 'empty', type: 'reasoning', summary: [], content: [], encrypted_content: 'opaque' },
    { id: 'body', type: 'reasoning', summary: [], content: ['Native display'], encrypted_content: 'opaque' },
  ] }] } }, 'p');
  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].reasoningText, 'Native display');
  assert.equal(snapshot.messages[0].content, '');
  const sparse = { thread: { id: 'p', turns: [{ id: 't', status: 'completed', items: [
    { id: 'r', type: 'reasoning', summary: [], content: [] },
  ] }] } };
  assert.equal(reconcileObservedReasoning(parseSnapshot(sparse, 'p').messages, messages, sparse)[0].reasoningText,
    'Native display text');
  assert.deepEqual(reconcileObservedReasoning([], messages, { thread: { turns: [] } }), []);
});

test('real sub-agent activity identity survives snapshots and live notices', () => {
  const item = { id: 'a', type: 'subAgentActivity', kind: 'started', agentThreadId: 'child',
    agentPath: 'root/worker', model: 'model-id', reasoningEffort: 'high' };
  const snapshot = parseSnapshot({ thread: { id: 'p', turns: [{ id: 't', status: 'completed', items: [item] }] } }, 'p');
  const live = applyNotice([], { method: 'item/completed', params: { turnId: 't', item } });
  for (const message of [snapshot.messages[0], live[0]]) {
    assert.equal(message.agentThreadId, 'child');
    assert.equal(message.agentPath, 'root/worker');
    assert.equal(message.agentStatus, 'started');
    assert.match(message.title, /启动/);
    assert.equal(message.detail, 'model-id · high');
  }
  const done = parseSnapshot({ thread: { id: 'child', name: 'worker', turns: [
    { id: 'ct', status: 'completed', items: [] },
  ] } }, 'child');
  assert.equal(done.threadName, 'worker');
  assert.equal(done.terminalStatus, 'completed');
  assert.equal(done.running, false);
  const failed = parseSnapshot({ thread: { id: 'child', turns: [
    { id: 'ct', status: 'failed', items: [] },
  ] } }, 'child');
  assert.equal(failed.terminalStatus, 'failed');
});

test('compaction waits for a new native activity and its own terminal turn', () => {
  const job = { phase: 'working', baseline: new Set(['old:a']), turnId: 'new' };
  const item = { id: 'new:a', turnId: 'new', activityType: 'contextCompaction', complete: true };
  assert.equal(compactionOutcome(job, [{ ...item, id: 'old:a', turnId: 'old', turnStatus: 'completed' }]), undefined);
  assert.equal(compactionOutcome(job, [item]), 'working');
  assert.equal(compactionOutcome(job, [{ ...item, turnStatus: 'completed' }]), 'completed');
  assert.equal(compactionOutcome(job, [{ ...item, turnStatus: 'failed' }]), 'failed');
  assert.equal(compactionBusy('unknown'), true);
  assert.equal(compactionBusy('unconfirmed'), false);
});

test('permission preference compares native effective policy, not merely its label', async () => {
  const first = { activePermissionProfile: { id: ':workspace' }, approvalsReviewer: 'user',
    approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite', writableRoots: ['C:/work'], networkAccess: false } };
  const same = { ...first, sandbox: { networkAccess: false, writableRoots: ['C:/work'], type: 'workspaceWrite' } };
  const changed = { ...first, sandbox: { ...first.sandbox, networkAccess: true } };
  const hash = await permissionFingerprint(first);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, await permissionFingerprint(same));
  assert.notEqual(hash, await permissionFingerprint(changed));
  assert.notEqual(hash, await permissionFingerprint({ ...first, approvalPolicy: 'never' }));
  assert.equal(await permissionFingerprint({}), null);
});

test('new custom threads require a matching native fingerprint after reload', () => {
  const workspace = {
    profile: ':workspace', reviewer: 'auto_review',
  };
  assert.deepEqual(resolveResumedPermission(workspace), {
    mode: 'auto-review', changed: false,
  });
  assert.deepEqual(resolveResumedPermission({
    ...workspace, savedFingerprint: 'a'.repeat(64), actualFingerprint: 'a'.repeat(64),
  }), { mode: 'custom', changed: false });
  assert.deepEqual(resolveResumedPermission({
    ...workspace, savedFingerprint: 'a'.repeat(64), actualFingerprint: 'b'.repeat(64),
  }), { mode: 'auto-review', changed: true });
  assert.deepEqual(resolveResumedPermission({
    ...workspace,
    selected: { mode: 'custom', profile: ':workspace', reviewer: 'auto_review' },
  }), { mode: 'custom', changed: false });
  assert.deepEqual(resolveResumedPermission({
    ...workspace,
    selected: { mode: 'default', profile: ':workspace', reviewer: 'user' },
  }), { mode: 'auto-review', changed: false });
});
