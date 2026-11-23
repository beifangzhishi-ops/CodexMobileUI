import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SidebarPinsStore } from '../gateway/sidebarPins';

test('6v owns one pin list, with idempotent concurrent writes from both clients', async () => {
  const directory = resolve('.tmp', 'pins-test-' + randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    const storeA = new SidebarPinsStore(directory);
    const storeB = new SidebarPinsStore(directory);
    await assert.rejects(storeA.list(), /PINS_PRIMARY_UNAVAILABLE/);
    await writeFile(resolve(directory, 'sidebar-pins-primary'), '6v');
    const project = { type: 'project' as const, hostId: '6v' as const, id: 'proj-1' };
    const thread = { type: 'thread' as const, hostId: 'noha' as const, id: 'thread-1' };
    await Promise.all([storeA.set(project, true), storeB.set(thread, true)]);
    const initial = await storeA.list();
    assert.equal(initial.items.length, 2);
    assert.ok(initial.items.some((item) => item.id === project.id && item.hostId === '6v'));
    assert.ok(initial.items.some((item) => item.id === thread.id && item.hostId === 'noha'));
    assert.equal((await storeB.set(project, true)).revision, 2);
    assert.deepEqual((await storeA.set(thread, false)).items, [project]);
    await assert.rejects(storeB.set({ ...thread, hostId: 'other' }, true), /PINS_INVALID_PARAMS/);
    await assert.rejects(storeB.set(thread, 'yes'), /PINS_INVALID_PARAMS/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
