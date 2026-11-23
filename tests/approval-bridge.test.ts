import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalBridge } from '../gateway/approvalBridge';

const native = (id = 41, decisions?: unknown[]) => JSON.stringify({
  id, method: 'item/commandExecution/requestApproval',
  params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
    command: 'echo hello', ...(decisions ? { availableDecisions: decisions } : {}) },
});
const reply = (id: number, decision: unknown) => JSON.stringify({ id, result: { decision } });

test('native approval response must match one outstanding request on the same connection', () => {
  const bridge = new ApprovalBridge();
  assert.equal(bridge.consumeMobileReply(reply(41, 'accept'), false), 'rejected');
  bridge.observeNativeFrame(native());
  assert.equal(bridge.consumeMobileReply(reply(41, 'accept'), false), 'allowed');
  assert.equal(bridge.consumeMobileReply(reply(41, 'accept'), false), 'rejected');
  assert.equal(new ApprovalBridge().consumeMobileReply(reply(41, 'accept'), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(JSON.stringify({ id: 8, method: 'thread/list', params: {} }), false),
    'not-reply');
  bridge.observeNativeFrame(native().replace('"id":41', '"id":"approval-uuid-1"'));
  assert.equal(bridge.consumeMobileReply(JSON.stringify({
    id: 'approval-uuid-1', result: { decision: 'accept' },
  }), false), 'allowed');
});

test('only server-advertised literal decisions are forwarded, never arbitrary amendments', () => {
  const bridge = new ApprovalBridge();
  bridge.observeNativeFrame(native(42, ['decline', { acceptWithExecpolicyAmendment: {} }]));
  assert.equal(bridge.consumeMobileReply(reply(42, 'accept'), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(JSON.stringify({
    id: 42, result: { decision: { acceptWithExecpolicyAmendment: {} } },
  }), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(reply(42, 'decline'), false), 'allowed');
});

test('file changes are supported and terminal/resolved notices invalidate stale requests', () => {
  const bridge = new ApprovalBridge();
  bridge.observeNativeFrame(JSON.stringify({ id: 50, method: 'item/fileChange/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'file-1' } }));
  bridge.observeNativeFrame(JSON.stringify({ method: 'serverRequest/resolved',
    params: { threadId: 'thread-1', requestId: 50 } }));
  assert.equal(bridge.consumeMobileReply(reply(50, 'accept'), false), 'rejected');
  bridge.observeNativeFrame(native(51));
  bridge.observeNativeFrame(JSON.stringify({ method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: 'turn-1' } } }));
  assert.equal(bridge.consumeMobileReply(reply(51, 'accept'), false), 'rejected');
});

test('malformed or unsolicited responses are rejected without affecting a real request', () => {
  const bridge = new ApprovalBridge();
  bridge.observeNativeFrame(native(52));
  for (const frame of [
    JSON.stringify({ id: 52, result: { decision: 'accept' }, method: 'other' }),
    JSON.stringify({ id: 52, result: { decision: 'accept', extra: true } }),
    JSON.stringify({ id: 52, result: { decision: 'acceptForSession' } }),
    JSON.stringify({ id: 52, error: { code: 0 } }),
  ]) assert.equal(bridge.consumeMobileReply(frame, false), 'rejected');
  assert.equal(bridge.consumeMobileReply(reply(52, 'decline'), false), 'allowed');
});

test('extra-permission approval grants only the native requested scope, or denies all', () => {
  const bridge = new ApprovalBridge();
  const permissionRequest = (id: number) => JSON.stringify({
    id, method: 'item/permissions/requestApproval',
    params: { threadId: 't', turnId: 'turn', itemId: 'permission-item',
      permissions: { network: { enabled: true }, fileSystem: null } },
  });
  bridge.observeNativeFrame(permissionRequest(78));
  assert.equal(bridge.consumeMobileReply(reply(78, 'accept'), false), 'rejected');
  const granted = bridge.consumeMobileReply(reply(78, 'grantSession'), false);
  assert.deepEqual(typeof granted === 'object' ? JSON.parse(granted.forwarded) : null, {
    id: 78, result: { permissions: { network: { enabled: true } }, scope: 'session' },
  });
  bridge.observeNativeFrame(permissionRequest(79));
  const denied = bridge.consumeMobileReply(reply(79, 'deny'), false);
  assert.deepEqual(typeof denied === 'object' ? JSON.parse(denied.forwarded) : null, {
    id: 79, result: { permissions: {}, scope: 'turn' },
  });
});

test('native MCP elicitation on a running tool is actionable and only its own reply is accepted', () => {
  const bridge = new ApprovalBridge();
  const id = 1_234_567_890;
  bridge.observeNativeFrame(JSON.stringify({ id, method: 'mcpServer/elicitation/request',
    params: { threadId: 't', serverName: 'codex_apps', turnId: null,
      mode: 'url', url: 'https://example.com/authorize', elicitationId: 'e1', message: 'Connect app' } }));
  assert.equal(bridge.consumeMobileReply(JSON.stringify({ id, result: { decision: 'accept' } }), false),
    'rejected');
  assert.equal(bridge.consumeMobileReply(JSON.stringify({ id,
    result: { action: 'accept', content: { secret: 'forged' } } }), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(JSON.stringify({ id, result: { action: 'accept' } }), false),
    'allowed');
  assert.equal(bridge.consumeMobileReply(JSON.stringify({ id, result: { action: 'accept' } }), false),
    'rejected');
});

test('MCP form accepts only explicitly requested typed values', () => {
  const bridge = new ApprovalBridge();
  bridge.observeNativeFrame(JSON.stringify({ id: 'mcp-42', method: 'mcpServer/elicitation/request',
    params: { threadId: 't', serverName: 'tools', mode: 'form', message: 'Choose',
      requestedSchema: { type: 'object', properties: {
        choice: { type: 'string', enum: ['yes', 'no'] }, count: { type: 'integer', minimum: 1 },
      }, required: ['choice'] },
    } }));
  const reply = (content: unknown) => JSON.stringify({ id: 'mcp-42',
    result: { action: 'accept', content } });
  assert.equal(bridge.consumeMobileReply(reply({ choice: 'maybe' }), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(reply({ choice: 'yes', extra: true }), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(reply({ choice: 'yes', count: 0 }), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(reply({ choice: 'yes', count: 2 }), false), 'allowed');
});

test('native requestUserInput accepts only answers to the outstanding tool questions', () => {
  const bridge = new ApprovalBridge();
  const id = 1000000005;
  bridge.observeNativeFrame(JSON.stringify({ id, method: 'item/tool/requestUserInput',
    params: { threadId: 't', turnId: 'turn', itemId: 'item', isBlocking: true, questions: [
      { id: 'choice', header: 'Choose', question: 'Proceed?',
        options: [{ label: 'Yes', description: 'Yes' }, { label: 'No', description: 'No' }] },
    ] } }));
  const reply = (answers: unknown) => JSON.stringify({ id, result: { answers } });
  assert.equal(bridge.consumeMobileReply(reply({ choice: { answers: ['unoffered'] } }), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(reply({ other: { answers: ['Yes'] } }), false), 'rejected');
  assert.equal(bridge.consumeMobileReply(reply({ choice: { answers: ['Yes'] } }), false), 'allowed');
  assert.equal(bridge.consumeMobileReply(reply({ choice: { answers: ['No'] } }), false), 'rejected');
});
