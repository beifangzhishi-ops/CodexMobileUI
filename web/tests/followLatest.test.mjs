import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceFromLatest, LATEST_THRESHOLD_PX, nextFollowLatest } from '../src/followLatest.ts';

test('distance accounts for short conversations, bottom spacing and overscroll', () => {
  assert.equal(distanceFromLatest(0, 900, 200), 0);
  assert.equal(distanceFromLatest(600, 500, 1200), 100);
  assert.equal(distanceFromLatest(750, 500, 1200), 0);
  assert.equal(distanceFromLatest(-20, 500, 1200), 700);
});

test('scrolling away pauses following; returning to the bottom resumes it', () => {
  assert.equal(nextFollowLatest(true, 500, 300, 200), false);
  assert.equal(nextFollowLatest(false, 300, 320, 180), false);
  assert.equal(nextFollowLatest(false, 320, 420, LATEST_THRESHOLD_PX), true);
});

test('incoming content height changes cannot undo a reader\'s follow choice', () => {
  assert.equal(nextFollowLatest(true, 500, 500, 400), true);
  assert.equal(nextFollowLatest(false, 500, 500, 400), false);
  assert.equal(nextFollowLatest(true, 500, 499.5, 300), true);
});
