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
