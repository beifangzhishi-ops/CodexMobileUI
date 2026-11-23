import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listProjectDirectories, resolveProjectDirectory,
} from '../gateway/projectDirectories';

test('project picker lists permitted directory roots and nested folders only', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mobile-project-picker-'));
  try {
    mkdirSync(join(home, 'Documents', 'Work', 'Repo'), { recursive: true });
    mkdirSync(join(home, 'Desktop'), { recursive: true });
    const root = await listProjectDirectories(undefined, home, '');
    assert.deepEqual(root.directories.map((item) => item.name), ['Documents', 'Desktop']);
    const documents = await listProjectDirectories('r0', home, '');
    assert.equal(documents.directories[0]?.name, 'Work');
    const nested = await listProjectDirectories('r0/Work', home, '');
    assert.equal(nested.directories[0]?.name, 'Repo');
    assert.equal(await resolveProjectDirectory('r0/Work/Repo', home, ''),
      join(home, 'Documents', 'Work', 'Repo'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('project picker rejects path traversal and unapproved filesystem roots', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mobile-project-scope-'));
  try {
    mkdirSync(join(home, 'Documents', 'Safe'), { recursive: true });
    for (const value of ['C:\\Windows', '../Windows', 'r99', 'r0/..',
      'r0/%2E%2E', 'r0/%2F', 'r0/%5C', 'r0/Safe/../../Windows',
      'r0/Safe%3A', 'r0/Safe/NotThere']) {
      await assert.rejects(resolveProjectDirectory(value, home, ''), () => true, value);
    }
    const custom = join(home, 'OtherProjects');
    mkdirSync(custom);
    assert.equal(await resolveProjectDirectory('r2', home, custom), custom);
    await assert.rejects(resolveProjectDirectory('r2', home, ''), /目录选择无效/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
