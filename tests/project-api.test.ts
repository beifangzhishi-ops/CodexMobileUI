import test from 'node:test';
import assert from 'node:assert/strict';
import { listAllProjects, threadCategory } from '../src/core/projectApi';
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

test('project membership uses only explicit native IDs in the private home', () => {
  const thread: CodexThread = {
    id: 'fresh', name: null, cwd: 'C:\\Work\\Nested', updatedAt: 4, projectId: null,
  };
  assert.equal(threadCategory(thread), 'uncategorized');
  assert.equal(threadCategory({ ...thread, projectId: 'project-id' }), 'project-id');
  assert.equal(threadCategory({ ...thread, cwd: 'C:\\Users\\Sam\\Documents\\Codex\\MobileUI\\2026-11-05\\1762320000000-1234567890abcdef' }), 'unassigned');
});

test('malformed project pages do not silently erase project listings', async () => {
  await assert.rejects(listAllProjects({
    async request() { return { data: [], nextCursor: 'same' }; },
  }), /分页游标无效/);
  await assert.rejects(listAllProjects({
    async request() { return { projects: [], nextCursor: null }; },
  }), /列表格式错误/);
});
