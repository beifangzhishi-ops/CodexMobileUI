import test from 'node:test';
import assert from 'node:assert/strict';
import { listAllProjects, threadCategory, threadProjectId } from '../src/core/projectApi';
import type { CodexThread } from '../src/core/protocol';

test('project/list paginates and preserves native IDs, names, order and roots', async () => {
  let calls = 0;
  const projects = await listAllProjects({
    async request(method, params) {
      assert.equal(method, 'project/list');
      calls++;
      if (calls === 1) {
        assert.equal(params.cursor, undefined);
        return { data: [
          { id: 'b', name: 'Beta', roots: [{ path: 'C:\\Work\\Beta' }], position: 2 },
        ], nextCursor: 'next' };
      }
      assert.equal(params.cursor, 'next');
      return { data: [
        { id: 'a', name: 'Alpha', roots: [{ path: 'C:\\Work\\Alpha' }], position: 1 },
        { id: 'b', name: 'Beta', roots: [{ path: 'C:\\Work\\Beta' }], position: 2 },
      ], nextCursor: null };
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(projects.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(projects[0].roots, ['C:\\Work\\Alpha']);
});

test('project membership prefers native projectId and otherwise longest cwd root', () => {
  const projects = [
    { id: 'root', name: 'Root', roots: ['C:\\Work'], position: 0 },
    { id: 'nested', name: 'Nested', roots: ['C:\\Work\\Nested'], position: 1 },
  ];
  const legacy: CodexThread = {
    id: 'old', name: null, cwd: 'c:/work/nested/src', updatedAt: 4, projectId: null,
  };
  assert.equal(threadProjectId(legacy, projects), 'nested');
  assert.equal(threadProjectId({ ...legacy, projectId: 'root' }, projects), 'root');
  assert.equal(threadCategory({ ...legacy, cwd: 'C:\\WorkOutside' }, projects), 'uncategorized');
  assert.equal(threadCategory({ ...legacy, cwd: 'C:\\Users\\Sam\\Documents\\Codex\\MobileUI\\2026-11-05\\1762320000000-1234567890abcdef' }, projects), 'unassigned');
});

test('malformed project pages do not silently erase project listings', async () => {
  await assert.rejects(listAllProjects({
    async request() { return { data: [], nextCursor: 'same' }; },
  }), /分页游标无效/);
  await assert.rejects(listAllProjects({
    async request() { return { projects: [], nextCursor: null }; },
  }), /列表格式错误/);
});
