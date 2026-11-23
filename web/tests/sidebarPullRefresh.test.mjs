import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { sidebarPullDistance, SIDEBAR_PULL_THRESHOLD } from '../src/sidebarPullRefresh.ts';

test('sidebar pull only activates at the top on a downward vertical drag', () => {
  assert.equal(sidebarPullDistance(100, 100, 100, 181, 0) >= SIDEBAR_PULL_THRESHOLD, true);
  assert.equal(sidebarPullDistance(100, 100, 100, 180, 2), 0);
  assert.equal(sidebarPullDistance(100, 100, 100, 60, 0), 0);
  assert.equal(sidebarPullDistance(100, 100, 190, 165, 0), 0);
  assert.equal(sidebarPullDistance(100, 100, 100, 145, 0) < SIDEBAR_PULL_THRESHOLD, true);
  assert.equal(sidebarPullDistance(100, 100, 100, 400, 0), 100);
});
