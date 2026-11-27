import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSidebarPreferences, parseSidebarPreferences,
  loadSidebarPreferences, saveSidebarPreferences, clampSidebarWidth,
} from '../src/sidebarPreferences.ts';

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test('new clients keep responsive default and recent project conversations visible', () => {
  assert.deepEqual(parseSidebarPreferences(null), defaultSidebarPreferences());
  assert.equal(parseSidebarPreferences(null).sidebarOpen, null);
});

test('reload retains each project, host, section and entire sidebar state', () => {
  const storage = memoryStorage();
  const selected = {
    showAllRecent: false,
    collapsedHosts: ['6v'],
    openedProjects: ['6v:project-one', 'noha:project-two'],
    collapsedSections: ['projects', 'recent'],
    sidebarOpen: false,
    sidebarWidth: 384,
  };
  saveSidebarPreferences(storage, selected);
  assert.deepEqual(loadSidebarPreferences(storage), selected);
  saveSidebarPreferences(storage, { ...selected, sidebarOpen: true, showAllRecent: true });
  assert.equal(loadSidebarPreferences(storage).sidebarOpen, true);
  assert.equal(loadSidebarPreferences(storage).showAllRecent, true);
});

test('old section folds migrate without resetting other first-visit defaults', () => {
  const storage = memoryStorage({
    'codex-web-collapsed-sections': JSON.stringify(['pinned', 'invalid', 'recent']),
  });
  assert.deepEqual(loadSidebarPreferences(storage).collapsedSections, ['pinned', 'recent']);
  assert.equal(loadSidebarPreferences(storage).showAllRecent, true);
  const current = { ...defaultSidebarPreferences(), showAllRecent: false };
  saveSidebarPreferences(storage, current);
  storage.setItem('codex-web-collapsed-sections', 'not JSON');
  assert.equal(loadSidebarPreferences(storage).showAllRecent, false);
});

test('malformed or overlong cached entries cannot break the sidebar', () => {
  assert.deepEqual(parseSidebarPreferences({
    showAllRecent: 'false', collapsedHosts: [1, '6v', '6v', 'bad/host', 'a'.repeat(250)],
    openedProjects: ['6v:valid', {}], collapsedSections: ['recent', 'bad'],
    sidebarOpen: 'false',
  }), {
    showAllRecent: true, collapsedHosts: ['6v'],
    openedProjects: ['6v:valid'], collapsedSections: ['recent'], sidebarOpen: null,
    sidebarWidth: 310,
  });
  assert.deepEqual(loadSidebarPreferences(memoryStorage({
    'codex-web-sidebar-preferences-v1': '{broken',
  })), defaultSidebarPreferences());
});

test('desktop sidebar width is bounded and kept per client profile', () => {
  assert.equal(clampSidebarWidth(10, 1400), 260);
  assert.equal(clampSidebarWidth(900, 1400), 480);
  assert.equal(clampSidebarWidth(460, 900), 450);
  assert.equal(parseSidebarPreferences({ sidebarWidth: 900 }).sidebarWidth, 480);
  assert.equal(defaultSidebarPreferences().sidebarWidth, 310);
});

test('unavailable storage never crashes the UI', () => {
  const storage = {
    getItem() { throw Error('disabled'); },
    setItem() { throw Error('disabled'); },
  };
  assert.deepEqual(loadSidebarPreferences(storage), defaultSidebarPreferences());
  assert.doesNotThrow(() => saveSidebarPreferences(storage, defaultSidebarPreferences()));
});
