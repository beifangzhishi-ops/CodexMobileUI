import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSidebarPins } from '../src/sidebarPins.ts';

test('shared pins keep host and type identity without trusting browser cache', () => {
  const valid = { revision: 3, items: [
    { type: 'project', hostId: '6v', id: 'project-1' },
    { type: 'thread', hostId: 'noha', id: 'thread-1' },
  ] };
  assert.deepEqual(parseSidebarPins(valid), valid);
  assert.throws(() => parseSidebarPins({ revision: 0, items: [
    { ...valid.items[0], hostId: 'arbitrary' },
  ] }), /INVALID_PINS/);
  assert.throws(() => parseSidebarPins({ revision: -1, items: [] }), /INVALID_PINS/);
});
