import test from 'node:test';
import assert from 'node:assert/strict';
import { permitMobileRpcFrame } from '../gateway/rpcPolicy';

test('mention catalog discovery permits read-only operations and rejects mutations', () => {
  const rpc = (method: string, params: unknown) => permitMobileRpcFrame(
    JSON.stringify({ id: 16, method, params }), false).allowed;
  assert.equal(rpc('skills/list', { cwds: ['C:\\Projects\\Demo'], forceReload: true }), true);
  assert.equal(rpc('app/list', { limit: 100, forceRefetch: true }), true);
  assert.equal(rpc('plugin/installed', { cwds: ['C:\\Projects\\Demo'] }), true);
  assert.equal(rpc('plugin/list', { forceRefetch: true }), true);
  for (const method of ['plugin/install', 'plugin/uninstall', 'app/write', 'skills/config/write',
    'account/read', 'config/read']) assert.equal(rpc(method, {}), false, method);
  assert.equal(rpc('skills/list', { cwds: ['relative'], forceReload: true }), false);
  assert.equal(rpc('plugin/installed', { installSuggestionPluginNames: ['uninstalled'] }), false);
  const input = [{ type: 'text', text: 'Use @skill-creator with @GitHub' },
    { type: 'skill', name: 'skill-creator', path: 'C:\\Tools\\skill-creator\\SKILL.md' },
    { type: 'mention', name: 'GitHub', path: 'app://github-123' }];
  assert.equal(rpc('turn/start', { threadId: 'thread-one', input }), true);
  assert.equal(rpc('turn/steer', { threadId: 'thread-one', expectedTurnId: 'turn-one', input }), true);
  assert.equal(rpc('thread/queue/add', { threadId: 'thread-one', clientUserMessageId: 'msg', input }), true);
  assert.equal(rpc('turn/start', { threadId: 'thread-one', input: [
    { type: 'text', text: 'x' },
    { type: 'mention', name: 'Unsafe', path: 'file:///etc/passwd' },
  ] }), false);
});

test('quota RPC allows only parameterless native rate-limit reads', () => {
  const allowed = (params: unknown) => permitMobileRpcFrame(JSON.stringify({
    id: 23, method: 'account/rateLimits/read', params,
  }), false).allowed;
  assert.equal(allowed({}), true);
  assert.equal(allowed({ accountId: 'another-account' }), false);
  assert.equal(allowed({ reset: true }), false);
  assert.equal(permitMobileRpcFrame(JSON.stringify({
    id: 24, method: 'account/rateLimits/reset', params: {},
  }), false).allowed, false);
});

test('follow-up RPC allowlist permits only bounded text and owned queue item actions', () => {
  const allowed: [string, object][] = [
    ['turn/steer', { threadId: 't', expectedTurnId: 'running-id', input: [{ type: 'text', text: 'next' }] }],
    ['thread/queue/add', { threadId: 't', clientUserMessageId: 'unique-id',
      input: [{ type: 'text', text: 'later' }] }],
    ['thread/queue/list', { threadId: 't', limit: 100 }],
    ['thread/queue/delete', { threadId: 't', queuedSubmissionId: 'queued-id' }],
    ['thread/queue/start', { threadId: 't', queuedSubmissionId: 'queued-id' }],
  ];
  const blocked: [string, object][] = [
    ['turn/steer', { threadId: 't', input: [{ type: 'text', text: 'hi' }], sandboxPolicy: 'dangerFullAccess' }],
    ['turn/steer', { threadId: 't', input: [{ type: 'text', text: '' }] }],
    ['thread/queue/add', { threadId: 't', clientUserMessageId: 'id', input: [{ type: 'localImage', path: '/etc/passwd' }] }],
    ['thread/queue/add', { threadId: 't', clientUserMessageId: 'id',
      input: [{ type: 'text', text: 'x'.repeat(12_001) }] }],
    ['thread/queue/add', { threadId: 't', clientUserMessageId: 'id',
      input: [{ type: 'text', text: 'hi' }], responsesapiClientMetadata: { secret: 'x' } }],
    ['thread/queue/list', { threadId: 't', limit: 500 }],
    ['thread/queue/delete', { threadId: 't', queuedSubmissionId: '' }],
    ['thread/queue/start', { threadId: 't', queuedSubmissionId: 'q', ignoreCurrentTurn: true }],
  ];
  for (const [method, params] of allowed) assert.equal(
    permitMobileRpcFrame(JSON.stringify({ id: 11, method, params }), false).allowed, true, method);
  for (const [method, params] of blocked) assert.equal(
    permitMobileRpcFrame(JSON.stringify({ id: 11, method, params }), false).allowed, false, method);
});

test('Funnel permits only turn-bounded native thread forks', () => {
  const allowed = (params: unknown) => permitMobileRpcFrame(
    JSON.stringify({ id: 22, method: 'thread/fork', params }), false).allowed;
  assert.equal(allowed({
    threadId: 'source-thread', lastTurnId: 'completed-turn', excludeTurns: true,
  }), true);
  for (const params of [
    { threadId: 'source-thread' },
    { threadId: 'source-thread', lastTurnId: 'completed-turn' },
    { threadId: 'source-thread', lastTurnId: '', excludeTurns: true },
    { threadId: 'source-thread', lastTurnId: 'completed-turn', excludeTurns: true,
      path: 'C:\\arbitrary' },
    { threadId: 'source-thread', lastTurnId: 'completed-turn', excludeTurns: true,
      ephemeral: true },
  ]) assert.equal(allowed(params), false);
});

test('Funnel gateway allows only the native RPC methods used by Stage 1 mobile', () => {
  for (const method of ['initialize', 'thread/list', 'thread/read',
    'turn/start', 'permissionProfile/list']) {
    assert.equal(permitMobileRpcFrame(JSON.stringify({ id: 1, method, params: {} }), false).allowed,
      true, method);
  }
  assert.equal(permitMobileRpcFrame(JSON.stringify({
    id: 1, method: 'thread/resume', params: { threadId: 'thread-1' },
  }), false).allowed, true);
  assert.equal(permitMobileRpcFrame('{"method":"initialized","params":{}}', false).allowed, true);
});

test('mobile permission selection uses native named profiles, never arbitrary policy objects', () => {
  const rpc = (method: string, params: unknown) =>
    permitMobileRpcFrame(JSON.stringify({ id: 5, method, params }), false).allowed;
  const turn = { threadId: 'thread-1', input: [{ type: 'text', text: 'hi' }] };
  const thread = { cwd: 'C:\\Code\\Repo', projectId: 'project-one' };
  assert.equal(rpc('permissionProfile/list', {}), true);
  assert.equal(rpc('thread/start', { ...thread, permissions: ':workspace', approvalsReviewer: 'user' }), true);
  assert.equal(rpc('thread/start', { ...thread, permissions: ':workspace', approvalsReviewer: 'auto_review' }), true);
  assert.equal(rpc('thread/start', { ...thread, permissions: ':read-only', approvalsReviewer: 'user' }), true);
  assert.equal(rpc('thread/start', { ...thread, permissions: ':danger-full-access', approvalsReviewer: 'user' }), true);
  assert.equal(rpc('thread/start', thread), true); // Custom: inherit computer config.toml
  assert.equal(rpc('turn/start', { ...turn, permissions: ':workspace', approvalsReviewer: 'auto_review' }), true);
  assert.equal(rpc('turn/start', { ...turn, permissions: ':read-only', approvalsReviewer: 'user' }), true);
  assert.equal(rpc('turn/start', { ...turn, permissions: ':danger-full-access', approvalsReviewer: 'user' }), true);
  assert.equal(rpc('turn/start', turn), true);
  assert.equal(rpc('thread/settings/update', { threadId: 'thread-1', permissions: null }), false);
  assert.equal(rpc('turn/start', { ...turn, model: 'ds/deepseek-flash', effort: 'high' }), true);
  assert.equal(rpc('turn/start', { ...turn, model: 'ds/deepseek-flash', collaborationMode: {
    mode: 'plan', settings: { model: 'ds/deepseek-flash', reasoning_effort: 'high', developer_instructions: null },
  } }), true);
  assert.equal(rpc('turn/start', { ...turn, model: 'ds/../flash' }), false);
  assert.equal(rpc('thread/settings/update', {
    threadId: 'thread-1', permissions: ':workspace', approvalsReviewer: 'auto_review',
  }), true);
  assert.equal(rpc('thread/settings/update', {
    threadId: 'thread-1', permissions: ':danger-full-access', approvalsReviewer: 'user',
  }), true);
  for (const params of [
    { threadId: 'thread-1', permissions: ':unknown' },
    { threadId: 'thread-1', permissions: null, approvalsReviewer: 'auto_review' },
    { threadId: 'thread-1', permissions: ':workspace' },
    { threadId: 'thread-1', permissions: ':workspace', approvalsReviewer: 'never' },
    { threadId: 'thread-1', permissions: ':workspace', approvalsReviewer: 'user', sandboxPolicy: {} },
    { threadId: 'thread-1', approvalPolicy: 'never' },
  ]) assert.equal(rpc('thread/settings/update', params), false);
  assert.equal(rpc('permissionProfile/list', { cwd: 'C:\\Windows' }), false);
  assert.equal(rpc('thread/resume', { threadId: 'thread-1', sandbox: 'danger-full-access' }), false);
  assert.equal(rpc('thread/start', { ...thread, permissions: 'attacker-profile', approvalsReviewer: 'user' }), false);
  assert.equal(rpc('thread/start', { ...thread, permissions: ':workspace', sandbox: 'danger-full-access', approvalsReviewer: 'user' }), false);
  assert.equal(rpc('thread/start', { ...thread, permissions: ':workspace', approvalsReviewer: 'never' }), false);
  assert.equal(rpc('turn/start', { ...turn, permissions: 'attacker-profile', approvalsReviewer: 'user' }), false);
  assert.equal(rpc('turn/start', { ...turn, permissions: ':workspace', approvalsReviewer: 'never' }), false);
  assert.equal(rpc('turn/start', { ...turn, approvalsReviewer: 'auto_review' }), false);
  assert.equal(rpc('turn/start', { ...turn, approvalPolicy: 'never' }), false);
});

test('Funnel gateway rejects privileged native operations and crafted JSON-RPC', () => {
  for (const method of ['command/exec', 'config/set', 'account/login',
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

test('interrupt is permitted only for an exact thread/turn pair', () => {
  const rpc = (method: string, params: unknown) =>
    permitMobileRpcFrame(JSON.stringify({ id: 19, method, params }), false).allowed;
  assert.equal(rpc('turn/interrupt', { threadId: 'thread-one', turnId: 'turn-one' }), true);
  for (const params of [{ threadId: 'thread-one' }, { turnId: 'turn-one' },
    { threadId: 'thread-one', turnId: 'turn-one', model: 'gpt' },
    { threadId: 'thread-one', turnId: '' },
    { threadId: 'thread-one', turnId: 'turn-one', force: true }]) {
    assert.equal(rpc('turn/interrupt', params), false);
  }
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
    ['turn/steer', { threadId: 'thread-1', expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: 'More information' }] }],
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
    ['turn/steer', { threadId: 'thread-1', input: [{ type: 'text', text: 'hi' }] }],
    ['turn/steer', { threadId: 'thread-1', expectedTurnId: 'turn-1', input: [] }],
    ['turn/steer', { threadId: 'thread-1', expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: 'hi' }], model: 'gpt-6' }],
    ['turn/steer', { threadId: 'thread-1', expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: 'hi' }], sandboxPolicy: { type: 'dangerFullAccess' } }],
  ] as const;
  for (const [method, params] of deny) {
    assert.equal(permitMobileRpcFrame(JSON.stringify({ id: 8, method, params }), false).allowed,
      false, method);
  }
});
