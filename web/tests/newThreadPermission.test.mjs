import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberNewThreadCustomPermission } from '../src/newThreadPermission.ts';

const effective = {
  activePermissionProfile: { id: ':workspace' },
  approvalsReviewer: 'auto_review',
  approvalPolicy: 'on-request',
  sandbox: { type: 'workspaceWrite', writableRoots: ['C:/repo'], networkAccess: false },
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('new-thread custom permission uses the direct native start response', async () => {
  let resumes = 0;
  let remembered;
  const mode = await rememberNewThreadCustomPermission({
    threadId: 'thread-1',
    startResponse: { thread: { id: 'thread-1' }, ...effective },
    readResume: async () => { resumes++; return effective; },
    remember: (value) => { remembered = value; },
  });
  assert.equal(mode, 'direct');
  assert.equal(resumes, 0);
  assert.equal(remembered.mode, 'custom');
  assert.equal(remembered.profile, ':workspace');
  assert.equal(remembered.reviewer, 'auto_review');
  assert.match(remembered.fingerprint, /^[a-f0-9]{64}$/);
});

test('missing effective fields use a best-effort resume fallback', async () => {
  let resumes = 0;
  let remembered;
  const mode = await rememberNewThreadCustomPermission({
    threadId: 'thread-2',
    startResponse: { thread: { id: 'thread-2' } },
    readResume: async () => { resumes++; return effective; },
    remember: (value) => { remembered = value; },
  });
  assert.equal(mode, 'fallback');
  assert.equal(remembered, undefined);
  assert.ok(resumes <= 1);
  await tick();
  await tick();
  assert.equal(resumes, 1);
  assert.equal(remembered.profile, ':workspace');
});

test('fallback resume failure cannot reject the acknowledged new thread', async () => {
  let remembered = false;
  const mode = await rememberNewThreadCustomPermission({
    threadId: 'thread-3',
    startResponse: { thread: { id: 'thread-3' } },
    readResume: () => { throw new Error('resume failed'); },
    remember: () => { remembered = true; },
  });
  assert.equal(mode, 'fallback');
  await tick();
  await tick();
  assert.equal(remembered, false);
});

test('stale pending fallback cannot overwrite a newer permission selection', async () => {
  let epoch = 0;
  let finishResume;
  let remembered = false;
  const mode = await rememberNewThreadCustomPermission({
    threadId: 'thread-4',
    startResponse: { thread: { id: 'thread-4' } },
    readResume: () => new Promise((resolve) => { finishResume = resolve; }),
    isCurrent: () => epoch === 0,
    remember: () => { remembered = true; },
  });
  assert.equal(mode, 'fallback');
  await tick();
  epoch = 1;
  finishResume(effective);
  await tick();
  await tick();
  assert.equal(remembered, false);
});
