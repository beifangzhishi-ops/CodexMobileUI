import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PROJECT_THREAD_PAGE_SIZE, PROJECT_THREAD_PREVIEW_LIMIT, clearProjectThreadLimit,
  nextProjectThreadLimit, visibleProjectThreads,
} from '../src/projectThreadVisibility.ts';

test('project conversations page five then ten more in native order until exhausted', () => {
  const threads = Array.from({ length: 23 }, (_, index) => ({ id: 'thread-' + index }));
  assert.equal(PROJECT_THREAD_PREVIEW_LIMIT, 5);
  assert.equal(PROJECT_THREAD_PAGE_SIZE, 10);
  assert.deepEqual(visibleProjectThreads(threads), threads.slice(0, 5));
  const fifteen = nextProjectThreadLimit(5, threads.length);
  assert.equal(fifteen, 15);
  assert.deepEqual(visibleProjectThreads(threads, fifteen), threads.slice(0, 15));
  const remaining = nextProjectThreadLimit(fifteen, threads.length);
  assert.equal(remaining, threads.length);
  assert.deepEqual(visibleProjectThreads(threads, remaining), threads);
  assert.equal(nextProjectThreadLimit(5, 8), 8);
  assert.deepEqual(visibleProjectThreads(threads.slice(0, 4)), threads.slice(0, 4));
});

test('closing a host/project placement resets only that project preview', () => {
  const sixV = '6v:project-1';
  const noha = 'noha:project-1';
  const other = '6v:project-2';
  const before = { [sixV]: 25, [noha]: 15, [other]: 15 };
  assert.deepEqual(clearProjectThreadLimit(before, sixV), { [noha]: 15, [other]: 15 });
  assert.deepEqual(before, { [sixV]: 25, [noha]: 15, [other]: 15 });
  assert.deepEqual(clearProjectThreadLimit(before, 'missing'), before);
});

test('Desktop project header and chevron share close-reset behavior without changing recent pagination', () => {
  const desktop = readFileSync(fileURLToPath(new URL('../src/DesktopApp.tsx', import.meta.url)), 'utf8');
  assert.match(desktop, /const \[projectThreadLimits, setProjectThreadLimits\] = useState<Record<string, number>>\(\{\}\)/);
  assert.match(desktop, /function toggleProject\(key: string\)/);
  assert.equal((desktop.match(/onClick=\{\(\) => toggleProject\(key\)\}/g) ?? []).length, 2);
  assert.match(desktop, /if \(closing\) setProjectThreadLimits\(\(current\) => clearProjectThreadLimit\(current, key\)\)/);
  assert.match(desktop, /nextProjectThreadLimit\(current\[key\] \?\? PROJECT_THREAD_PREVIEW_LIMIT, children\.length\)/);
  assert.match(desktop, /recents\.slice\(0, recentLimit\)/);
  assert.match(desktop, /setRecentLimit\(\(count\) => count \+ 10\)/);
});
