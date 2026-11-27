import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updatePermissionFromNativeConfig, updateThreadSettings, validThreadSettingsUpdate,
} from '../server/threadSettingsPolicy.mjs';
import { validModelIdentifier } from '../server/modelIdentifier.mjs';

function subset(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key));
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function validPermissions(value) {
  if (!subset(value, ['permissions', 'approvalsReviewer'])) return false;
  if (![':workspace', ':read-only', ':danger-full-access'].includes(value.permissions)) return false;
  if (value.approvalsReviewer !== undefined &&
      !['user', 'auto_review'].includes(value.approvalsReviewer)) return false;
  return value.permissions !== ':danger-full-access' || value.approvalsReviewer !== 'auto_review';
}

const validators = { subset, validId, validModelIdentifier, validPermissions };
const valid = (params) => validThreadSettingsUpdate(params, validators);

test('Web Bridge accepts existing-thread model and effort updates and rejects malformed fields', () => {
  assert.equal(valid({ threadId: '01a218cc-2c0e-7393-bb6a-bf4d152c0af1',
    model: 'gpt-6-luna', effort: 'medium' }), true);
  assert.equal(valid({ threadId: '01a218cc-2c0e-7393-bb6a-bf4d152c0af1',
    model: 'ds/deepseek-flash', effort: 'high' }), true);
  assert.equal(valid({ threadId: '01a218cc-2c0e-7393-bb6a-bf4d152c0af1',
    model: 'gpt-6-luna' }), true);

  for (const params of [
    { threadId: '', model: 'gpt-6-luna', effort: 'medium' },
    { threadId: 'thread-1', model: 'gpt-6-luna', effort: 'invalid' },
    { threadId: 'thread-1', model: 'gpt-6-luna', effort: 'medium', config: {} },
    { threadId: 'thread-1', model: 'gpt-6-luna', effort: 'medium', permissions: 'default' },
    { threadId: 'thread-1', model: 'ds/../flash', effort: 'medium' },
  ]) assert.equal(valid(params), false, JSON.stringify(params));
});

test('Web Bridge keeps existing-thread permission updates behind the validated branch', () => {
  assert.equal(valid({ threadId: 'thread-1', permissions: ':workspace',
    approvalsReviewer: 'user' }), true);
  for (const params of [
    { threadId: 'thread-1', permissions: ':workspace', approvalsReviewer: 'never' },
    { threadId: 'thread-1', permissions: undefined },
    { threadId: 'thread-1', permissions: ':workspace', approvalsReviewer: 'user', model: 'gpt-6-luna' },
    { threadId: 'thread-1', permissions: ':workspace', approvalsReviewer: 'user', sandboxPolicy: {} },
  ]) assert.equal(valid(params), false, JSON.stringify(params));
});

test('Web Bridge settings-update request path verifies and forwards model changes', async () => {
  const calls = [];
  const result = await updateThreadSettings({
    threadId: '01a218cc-2c0e-7393-bb6a-bf4d152c0af1',
    model: 'gpt-6-luna',
    effort: 'medium',
  }, {
    verifyModelChoice: async (model, effort) => {
      calls.push(['model/list', model, effort]);
    },
    internalRequest: async (method, params) => {
      calls.push([method, params]);
      return { updated: true };
    },
  });
  assert.deepEqual(result, { updated: true });
  assert.deepEqual(calls, [
    ['model/list', 'gpt-6-luna', 'medium'],
    ['thread/settings/update', {
      threadId: '01a218cc-2c0e-7393-bb6a-bf4d152c0af1',
      model: 'gpt-6-luna',
      effort: 'medium',
    }],
  ]);
});

test('Web Bridge settings-update request path verifies the allowed permission profile', async () => {
  const calls = [];
  const internalRequest = async (method, params) => {
    calls.push([method, params]);
    return method === 'permissionProfile/list'
      ? { data: [{ id: ':workspace', allowed: true }] }
      : { updated: true };
  };
  await updateThreadSettings({
    threadId: 'thread-1',
    permissions: ':workspace',
    approvalsReviewer: 'user',
  }, {
    verifyModelChoice: async () => assert.fail('permission updates must not verify a model'),
    internalRequest,
  });
  assert.deepEqual(calls, [
    ['permissionProfile/list', {}],
    ['thread/settings/update', {
      threadId: 'thread-1',
      permissions: ':workspace',
      approvalsReviewer: 'user',
    }],
  ]);
});

test('permission updates reject a profile the native catalog does not allow', async () => {
  await assert.rejects(updateThreadSettings({
    threadId: 'thread-1', permissions: ':workspace', approvalsReviewer: 'user',
  }, {
    verifyModelChoice: async () => assert.fail('permission updates must not verify a model'),
    internalRequest: async () => ({ data: [{ id: ':workspace', allowed: false }] }),
  }), /PERMISSION_NOT_ALLOWED/);
});

test('Custom permission uses native cwd defaults and confirms update through resume', async () => {
  const calls = [];
  const nativeFixture = {
    thread: { id: 'thread-1', cwd: 'C:\\fixture-project', turns: [{ status: 'completed' }] },
    defaults: {
      activePermissionProfile: { id: ':workspace' },
      sandbox: { type: 'workspaceWrite', writableRoots: ['C:\\fixture-project'] },
      approvalPolicy: 'on-request', approvalsReviewer: 'user',
    },
    resumed: {
      activePermissionProfile: { id: ':workspace' },
      sandbox: { type: 'workspaceWrite', writableRoots: ['C:\\fixture-project'] },
      approvalPolicy: 'on-request', approvalsReviewer: 'user',
    },
  };
  const result = await updatePermissionFromNativeConfig('thread-1', {
    internalRequest: async (method, params) => {
      calls.push([method, params]);
      if (method === 'thread/read') return { thread: nativeFixture.thread };
      if (method === 'thread/start') return nativeFixture.defaults;
      if (method === 'thread/settings/update') return { updated: true };
      if (method === 'thread/resume') return nativeFixture.resumed;
      assert.fail('unexpected native method: ' + method);
    },
    settingsFromNativeDefault: (native) => {
      assert.deepEqual(native, nativeFixture.defaults);
      return {
        update: {
          permissions: ':workspace', approvalPolicy: 'on-request', approvalsReviewer: 'user',
        },
        expected: {
          profile: ':workspace', reviewer: 'user', approvalPolicy: 'on-request',
          sandbox: nativeFixture.defaults.sandbox,
        },
      };
    },
    verifyNativePermissionApplied: (native, expected) => {
      assert.deepEqual(native, nativeFixture.resumed);
      assert.deepEqual(expected, {
        profile: ':workspace', reviewer: 'user', approvalPolicy: 'on-request',
        sandbox: nativeFixture.defaults.sandbox,
      });
      return { profile: ':workspace', reviewer: 'user' };
    },
  });
  assert.deepEqual(result, { profile: ':workspace', reviewer: 'user' });
  assert.deepEqual(calls, [
    ['thread/read', { threadId: 'thread-1', includeTurns: true }],
    ['thread/start', { cwd: 'C:\\fixture-project', ephemeral: true }],
    ['thread/settings/update', {
      threadId: 'thread-1', permissions: ':workspace',
      approvalPolicy: 'on-request', approvalsReviewer: 'user',
    }],
    ['thread/resume', { threadId: 'thread-1' }],
  ]);
});

test('Custom permission refuses missing, busy and incomplete native thread fixtures', async () => {
  const run = (thread) => updatePermissionFromNativeConfig('thread-1', {
    internalRequest: async (method) => method === 'thread/read' ? { thread } : assert.fail('must stop after read'),
    settingsFromNativeDefault: () => assert.fail('must not resolve a missing/busy thread'),
    verifyNativePermissionApplied: () => assert.fail('must not resume a missing/busy thread'),
  });
  await assert.rejects(run({ id: 'other', cwd: 'C:\\fixture-project' }), /THREAD_NOT_FOUND/);
  await assert.rejects(run({ id: 'thread-1', cwd: '', turns: [] }), /THREAD_NOT_FOUND/);
  await assert.rejects(run({ id: 'thread-1', cwd: 'C:\\fixture-project',
    turns: [{ status: 'inProgress' }] }), /THREAD_BUSY/);
});
