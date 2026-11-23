import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsFromNativeDefault, verifyNativePermissionApplied } from '../gateway/nativePermission';

const minimal = {
  approvalPolicy: 'on-request', approvalsReviewer: 'user',
  sandbox: { type: 'readOnly', networkAccess: false },
  activePermissionProfile: { id: ':read-only', extends: null },
};

test('host passes through native default rather than guessing workspace access', () => {
  const settings = settingsFromNativeDefault(minimal);
  assert.deepEqual(settings.update, {
    permissions: ':read-only', approvalsReviewer: 'user', approvalPolicy: 'on-request',
  });
  assert.deepEqual(verifyNativePermissionApplied(minimal, settings.expected),
    { profile: ':read-only', reviewer: 'user' });
});

test('named custom profiles are passed through without interpreting config files', () => {
  const response = { ...minimal,
    activePermissionProfile: { id: 'owner-defined', extends: ':workspace' },
    approvalsReviewer: 'auto_review',
  };
  assert.deepEqual(settingsFromNativeDefault(response).update, {
    permissions: 'owner-defined', approvalsReviewer: 'auto_review', approvalPolicy: 'on-request',
  });
});

test('legacy sandbox and granular review options preserve original native objects', () => {
  const sandbox = { type: 'workspaceWrite', writableRoots: ['C:\\Repo'],
    networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true };
  const policy = { granular: { sandbox_approval: true, rules: false,
    skill_approval: true, request_permissions: true, mcp_elicitations: false } };
  const source = { ...minimal, activePermissionProfile: null, sandbox, approvalPolicy: policy };
  const settings = settingsFromNativeDefault(source);
  assert.deepEqual(settings.update,
    { sandboxPolicy: sandbox, approvalPolicy: policy, approvalsReviewer: 'user' });
  assert.deepEqual(verifyNativePermissionApplied(source, settings.expected),
    { profile: null, reviewer: 'user' });
});

test('host fails closed on malformed native settings and any mismatched applied state', () => {
  for (const value of [
    null, { ...minimal, approvalsReviewer: 'unknown' },
    { ...minimal, sandbox: { type: 'unsupported' } },
    { ...minimal, approvalPolicy: null },
    { ...minimal, activePermissionProfile: { id: 'x'.repeat(129) } },
  ]) assert.throws(() => settingsFromNativeDefault(value), /NATIVE_DEFAULT_UNAVAILABLE/);
  const settings = settingsFromNativeDefault(minimal);
  assert.throws(() => verifyNativePermissionApplied({ ...minimal,
    sandbox: { type: 'readOnly', networkAccess: true } }, settings.expected),
  /NATIVE_PERMISSION_NOT_CONFIRMED/);
});
