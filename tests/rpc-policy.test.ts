import test from 'node:test';
import assert from 'node:assert/strict';
import { permitMobileRpcFrame } from '../gateway/rpcPolicy';

test('Funnel gateway allows only the native RPC methods used by Stage 1 mobile', () => {
  for (const method of ['initialize', 'thread/list', 'thread/read',
    'thread/resume', 'thread/start', 'turn/start']) {
    assert.equal(permitMobileRpcFrame(JSON.stringify({ id: 1, method, params: {} }), false).allowed,
      true, method);
  }
  assert.equal(permitMobileRpcFrame('{"method":"initialized","params":{}}', false).allowed, true);
});

test('Funnel gateway rejects privileged native operations and crafted JSON-RPC', () => {
  for (const method of ['command/exec', 'config/set', 'account/login', 'turn/interrupt',
    'item/read', 'thread/rollback', 'thread/compact', 'initialized']) {
    const frame = permitMobileRpcFrame(JSON.stringify({ id: 3, method, params: {} }), false);
    assert.deepEqual(frame, { allowed: false, id: 3 }, method);
  }
  assert.equal(permitMobileRpcFrame('{"id":8,"result":{}}', false).allowed, false);
  assert.equal(permitMobileRpcFrame('not-json', false).allowed, false);
  assert.equal(permitMobileRpcFrame('{"id":1,"method":"thread/list"}', true).allowed, false);
  assert.equal(permitMobileRpcFrame('{"id":1,"method":"thread/list","error":{}}', false).allowed, false);
  assert.equal(permitMobileRpcFrame('{"method":"thread/list"}', false).allowed, false);
});

test('project reading, thread moving and naming allow only narrow validated parameters', () => {
  const allowed = [
    ['project/list', { limit: 100 }],
    ['project/read', { projectId: 'project-a' }],
    ['thread/metadata/update', { threadId: 'thread-one', projectId: 'project-two' }],
    ['thread/name/set', { threadId: 'thread-one', name: '重命名会话' }],
  ] as const;
  for (const [method, params] of allowed) {
    assert.equal(permitMobileRpcFrame(JSON.stringify({ id: 8, method, params }), false).allowed,
      true, method);
  }
  const blocked = [
    ['project/list', { limit: 1_000_000 }],
    ['project/read', {}],
    ['thread/metadata/update', { threadId: 't', projectId: 'x', gitInfo: { branch: 'main' } }],
    ['thread/metadata/update', { threadId: 't', projectId: null }],
    ['thread/name/set', { threadId: 't', name: 'a\nb' }],
    ['thread/name/set', { threadId: 't', name: 'a'.repeat(81) }],
    ['fs/createDirectory', { path: 'C:\\Windows', recursive: true }],
    ['workspace/prepare', { draftId: 'anything' }],
  ] as const;
  for (const [method, params] of blocked) {
    assert.equal(permitMobileRpcFrame(JSON.stringify({ id: 9, method, params }), false).allowed,
      false, method);
  }
  assert.equal(permitMobileRpcFrame(JSON.stringify({
    id: 1_000_000_000, method: 'thread/list', params: {},
  }), false).allowed, false);
});

test('visual conversation and project actions require exact validated native parameters', () => {
  const allow = [
    ['thread/archive', { threadId: 'thread-1' }],
    ['thread/unarchive', { threadId: 'thread-1' }],
    ['thread/delete', { threadId: 'thread-1' }],
    ['project/create', { name: 'Project', roots: [], idempotencyKey: 'unique-key' }],
    ['project/update', { projectId: 'project-1', name: 'New name' }],
    ['project/delete', { projectId: 'project-1' }],
    ['model/list', { limit: 100 }],
    ['turn/start', { threadId: 'thread-1', input: [{ type: 'text', text: 'hello' }],
      model: 'gpt-5.6-codex', effort: 'high', serviceTierForTurn: 'default' }],
  ] as const;
  for (const [method, params] of allow) {
    assert.equal(permitMobileRpcFrame(JSON.stringify({ id: 7, method, params }), false).allowed,
      true, method);
  }
  const deny = [
    ['thread/delete', { threadId: 't', force: true }],
    ['thread/delete', { threadId: '' }],
    ['project/create', { name: 'Unsafe', roots: [{ path: 'C:\\Windows' }],
      idempotencyKey: 'unique-key' }],
    ['project/update', { projectId: 'p', roots: [{ path: 'C:\\Windows' }] }],
    ['project/update', { projectId: 'p', name: 'bad\nname' }],
    ['project/delete', {}],
    ['model/list', { limit: 500 }],
    ['turn/start', { threadId: 'thread-1', input: [{ type: 'text', text: 'hi' }],
      sandboxPolicy: { type: 'dangerFullAccess' } }],
    ['turn/start', { threadId: 'thread-1', input: [{ type: 'text', text: 'hi' }],
      approvalPolicy: 'never' }],
    ['turn/start', { threadId: 'thread-1', input: [{ type: 'text', text: '' }] }],
    ['turn/start', { threadId: 'thread-1', input: [{ type: 'text', text: 'hi' }],
      effort: 'unsupported' }],
  ] as const;
  for (const [method, params] of deny) {
    assert.equal(permitMobileRpcFrame(JSON.stringify({ id: 8, method, params }), false).allowed,
      false, method);
  }
});
