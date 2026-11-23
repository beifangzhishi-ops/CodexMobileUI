import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cachedMentions, fetchMentions, filteredMentions, mentionQuery, refreshCachedMentions,
  selectedNativeMentions,
} from '../../shared/mentions.ts';

const skill = { enabled: true, name: 'skill-creator',
  path: 'C:\\Tools\\skills\\skill-creator\\SKILL.md', description: 'Create Skills',
  interface: { displayName: 'Skill Creator', shortDescription: 'Scaffold a Skill' } };
const app = { id: 'github-123', name: 'GitHub', isAccessible: true, isEnabled: true };
const plugin = { name: 'workspace-review', id: 'workspace-review@official',
  installed: true, enabled: true, interface: { displayName: 'Workspace Review',
    shortDescription: 'Review workspace' } };

test('native catalogs are parsed and only accessible or installed entries are exposed', async () => {
  const calls = [];
  const items = await fetchMentions(async (method, params) => {
    calls.push([method, params]);
    if (method === 'skills/list') return { data: [{ cwd: 'C:\\Repo', skills: [skill, {
      ...skill, name: 'hidden', enabled: false,
    }] }] };
    if (method === 'app/list') return { data: [app, { ...app, id: 'disabled', isEnabled: false }] };
    if (method === 'plugin/installed') return { marketplaces: [{
      name: 'official', plugins: [plugin, { ...plugin, name: 'not-installed', installed: false }],
    }] };
    throw Error('Unexpected ' + method);
  }, 'C:\\Repo', 'thread-one');
  assert.deepEqual(items.map((item) => [item.kind, item.name, item.path]), [
    ['skill', 'skill-creator', skill.path],
    ['app', 'GitHub', 'app://github-123'],
    ['plugin', 'workspace-review', 'plugin://workspace-review@official'],
  ]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0][1].cwds, ['C:\\Repo']);
  assert.equal(calls[1][1].threadId, 'thread-one');
  assert.deepEqual(filteredMentions(items, 'scaffold').map((item) => item.kind), ['skill']);
});

test('the plugin fallback and independent catalog errors preserve available entries', async () => {
  const items = await fetchMentions(async (method) => {
    if (method === 'skills/list') return { data: [{ skills: [skill] }] };
    if (method === 'app/list' || method === 'plugin/installed') throw Error('Not supported');
    if (method === 'plugin/list') return { marketplaces: [{
      name: 'official', plugins: [plugin],
    }] };
    throw Error('Unexpected');
  });
  assert.deepEqual(items.map((item) => item.kind), ['skill', 'plugin']);
  await assert.rejects(() => fetchMentions(async () => { throw Error('offline'); }),
    /MENTION_CATALOG_UNAVAILABLE/);
});

test('partial network errors retain stale entries only for failed categories', async () => {
  const cached = [
    { kind: 'skill', name: 'old-skill', path: 'C:\\Old\\SKILL.md', label: 'Old',
      description: '' },
    { kind: 'app', name: 'GitHub', path: 'app://github-123', label: 'GitHub',
      description: '' },
    { kind: 'plugin', name: 'workspace-review', path: 'plugin://workspace-review@official',
      label: 'Workspace Review', description: '' },
  ];
  const fresh = await fetchMentions(async (method) => {
    if (method === 'skills/list') return { data: [{ skills: [skill] }] };
    if (method === 'app/list') return { data: [] };
    throw Error('Plugin temporarily unavailable');
  }, null, null, cached);
  assert.deepEqual(fresh.map((item) => [item.kind, item.name]), [
    ['skill', 'skill-creator'],
    ['plugin', 'workspace-review'],
  ]);
});

test('app/list pagination follows native cursors without refetching every page', async () => {
  const appCalls = [];
  const result = await fetchMentions(async (method, params) => {
    if (method === 'skills/list') return { data: [] };
    if (method === 'plugin/installed') return { marketplaces: [] };
    if (method === 'app/list') {
      appCalls.push(params);
      return params.cursor ? { data: [{ ...app, id: 'app-two', name: 'Second' }],
        nextCursor: null } : { data: [app], nextCursor: 'next' };
    }
    throw Error('Unexpected request');
  });
  assert.deepEqual(result.filter((item) => item.kind === 'app').map((item) => item.name),
    ['GitHub', 'Second']);
  assert.equal(appCalls.length, 2);
  assert.equal(appCalls[0].forceRefetch, false);
  assert.equal(appCalls[1].forceRefetch, false);
  assert.equal(appCalls[1].cursor, 'next');
});

test('plugin-owned Skills appear only under their parent plugin, including when searching by skill', async () => {
  const pluginId = 'workspace-review@official';
  const items = await fetchMentions(async (method) => {
    if (method === 'skills/list') return { data: [{ skills: [
      { ...skill, name: 'review-helper', path: 'C:\\Tools\\skills\\review-helper\\SKILL.md',
        pluginId }, skill,
    ] }] };
    if (method === 'app/list') return { data: [app] };
    if (method === 'plugin/installed') return { marketplaces: [{ name: 'official', plugins: [{
      ...plugin, interface: { ...plugin.interface,
        composerIconUrl: 'https://assets.example.test/review.png' },
    }] }] };
    throw Error('Unexpected request');
  });
  const visible = filteredMentions(items, '');
  assert.deepEqual(visible.map((item) => item.kind), ['plugin', 'app', 'skill']);
  assert.equal(visible[0].skillCount, 1);
  assert.equal(visible[0].iconUrl, 'https://assets.example.test/review.png');
  assert.deepEqual(filteredMentions(items, 'review-helper').map((item) => item.kind), ['plugin']);
  assert.deepEqual(filteredMentions(items.filter((item) => item.kind !== 'plugin'), '')
    .map((item) => item.kind), ['app', 'skill']);
  assert.deepEqual(selectedNativeMentions('@workspace-review', [visible[0]]), [
    { type: 'mention', name: 'workspace-review', path: 'plugin://workspace-review@official' },
  ]);
});

test('catalogs publish independently as each source responds, without forced refresh', async () => {
  let unblockApps;
  const appsPending = new Promise((resolve) => { unblockApps = resolve; });
  const observed = [];
  const methods = [];
  const task = fetchMentions(async (method, params) => {
    methods.push([method, params]);
    if (method === 'skills/list') return { data: [{ skills: [skill] }] };
    if (method === 'plugin/installed') return { marketplaces: [] };
    if (method === 'app/list') return appsPending;
    throw Error(method);
  }, null, null, [], (items) => observed.push(items.map((item) => item.kind)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(observed.length >= 2, 'skills and plugins can render before app/list completes');
  assert.deepEqual(methods.find(([name]) => name === 'skills/list')[1], { forceReload: false });
  assert.equal(methods.find(([name]) => name === 'app/list')[1].forceRefetch, false);
  unblockApps({ data: [app] });
  assert.deepEqual((await task).map((item) => item.kind), ['skill', 'app']);
});

test('cache serves stale results immediately and shares an in-flight refresh for one scope', async () => {
  const scope = 'mentions-test:cache-once';
  let unblockApps;
  let calls = 0;
  const appsPending = new Promise((resolve) => { unblockApps = resolve; });
  const request = async (method) => {
    calls++;
    if (method === 'skills/list') return { data: [{ skills: [skill] }] };
    if (method === 'plugin/installed') return { marketplaces: [] };
    if (method === 'app/list') return appsPending;
    throw Error(method);
  };
  const updates = [];
  const first = refreshCachedMentions(scope, request, null, null,
    (items) => updates.push(items.map((item) => item.kind)));
  const second = refreshCachedMentions(scope, request);
  assert.strictEqual(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cachedMentions(scope).map((item) => item.kind), ['skill']);
  unblockApps({ data: [app] });
  await first;
  assert.equal(calls, 3);
  assert.deepEqual(cachedMentions(scope).map((item) => item.kind), ['skill', 'app']);
  assert.ok(updates.length >= 2);
});

test('an @ query is relative to the caret, not any earlier word or email', () => {
  assert.deepEqual(mentionQuery('请用 @github', 10), { start: 3, query: 'github' });
  assert.deepEqual(mentionQuery('请用@GitHub', 10), { start: 2, query: 'GitHub' });
  assert.equal(mentionQuery('mail@example.com', 16), null);
  assert.deepEqual(mentionQuery('one @sk more', 7), { start: 4, query: 'sk' });
  assert.equal(mentionQuery('one @sk more', 12), null);
});

test('selected mentions preserve native identity while avoiding bare user-typed @', () => {
  const items = [
    { kind: 'skill', name: skill.name, path: skill.path },
    { kind: 'app', name: 'GitHub', path: 'app://github-123' },
    { kind: 'plugin', name: 'workspace-review', path: 'plugin://workspace-review@official' },
  ];
  assert.deepEqual(selectedNativeMentions('Use @skill-creator and @GitHub please', items), [
    { type: 'skill', name: 'skill-creator', path: skill.path },
    { type: 'mention', name: 'GitHub', path: 'app://github-123' },
  ]);
  assert.deepEqual(selectedNativeMentions('not@GitHub and @workspace-reviewing', items), []);
  assert.deepEqual(selectedNativeMentions('请用@GitHub看看', items), [
    { type: 'mention', name: 'GitHub', path: 'app://github-123' },
  ]);
});

test('same-name plugin choices never invoke multiple marketplaces unintentionally', () => {
  const items = [
    { kind: 'plugin', name: 'review', path: 'plugin://review@first' },
    { kind: 'plugin', name: 'review', path: 'plugin://review@second' },
  ];
  assert.deepEqual(selectedNativeMentions('@review', items), [
    { type: 'mention', name: 'review', path: 'plugin://review@second' },
  ]);
});
