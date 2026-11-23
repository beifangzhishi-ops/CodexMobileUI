import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, rm, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicationStore, explicitFileLinks } from '../gateway/publications';
import { attachmentRoot } from '../gateway/attachments';
import { localFileLinks, renderableLocalFileLinks } from '../shared/localFileLinks';

test('only explicit assistant file links qualify; absolute path in prose is ignored', () => {
  assert.deepEqual(explicitFileLinks('普通路径 C:\\Repo\\report.md'), []);
  assert.deepEqual(explicitFileLinks('[report](C:\\Repo\\report.md)'), [
    { name: 'report.md', path: 'C:\\Repo\\report.md' },
  ]);
  assert.deepEqual(explicitFileLinks('[secret](C:\\Repo\\.env)'), [
    { name: '.env', path: 'C:\\Repo\\.env' },
  ]);
  assert.deepEqual(explicitFileLinks('[config](D:\\Other Folder\\options.ini)'), [
    { name: 'options.ini', path: 'D:\\Other Folder\\options.ini' },
  ]);
  assert.deepEqual(explicitFileLinks('[program](C:\\Program Files (x86)\\program.exe)'), [
    { name: 'program.exe', path: 'C:\\Program Files (x86)\\program.exe' },
  ]);
  assert.deepEqual(explicitFileLinks('[report](<C:\\Folder (2026)\\report>)'), [
    { name: 'report', path: 'C:\\Folder (2026)\\report' },
  ]);
  assert.deepEqual(explicitFileLinks('`[not link](C:\\Repo\\secret.txt)`'), []);
  assert.deepEqual(explicitFileLinks('```md\n[not link](C:\\Repo\\secret.txt)\n```'), []);
});

test('local Markdown link projection preserves native text and its file target', () => {
  const original = '请下载 [测试报告](C:\\Program Files\\Project\\report.pdf) 和 [网站](https://example.com)。';
  const rendered = renderableLocalFileLinks(original);
  assert.equal(rendered.markdown,
    '请下载 [测试报告](https://codexmobile.invalid/local-file/0) 和 [网站](https://example.com)。');
  assert.equal(rendered.targets['https://codexmobile.invalid/local-file/0']?.path,
    'C:\\Program Files\\Project\\report.pdf');
  assert.equal(original.includes('Program Files'), true, 'raw assistant history remains unchanged');
  assert.deepEqual(localFileLinks('[report](file:///C:/Some%20Folder/report.pdf)'), [
    { label: 'report', path: 'C:\\Some Folder\\report.pdf', start: 0, end: 45 },
  ]);
});

test('source locations and alternate streams cannot create publications', () => {
  assert.deepEqual(explicitFileLinks('[source](C:/Repo/file.ts:185:2)'), []);
  assert.deepEqual(explicitFileLinks('[stream](C:/Repo/file.ts:private)'), []);
});

test('published files are immutable after original changes or deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-publish-'));
  const state = join(root, '.state');
  const work = join(root, 'project');
  await mkdir(state); await mkdir(work);
  const path = join(work, 'result.md');
  await writeFile(path, '# snapshot\n');
  const store = new PublicationStore(join(state, 'oauth.json'));
  const read = { thread: { id: 't', cwd: work, turns: [{ items: [
    { id: 'msg', type: 'agentMessage', text: `[result](${path})` },
  ] }] } };
  try {
    const first = await store.listFromThread('t', read);
    assert.equal(first.length, 1);
    assert.equal(first[0].status, 'ready');
    await writeFile(path, '# changed\n');
    const next = await store.listFromThread('t', read);
    assert.deepEqual(next, first);
    await unlink(path);
    const afterDeletion = await store.listFromThread('t', read);
    assert.deepEqual(afterDeletion, first);
    const content = await store.read(first[0].id, 0);
    assert.equal(Buffer.from(content.data, 'base64').toString(), '# snapshot\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unreadable assistant deliverable creates an unavailable card', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-publish-missing-'));
  try {
    const store = new PublicationStore(join(root, '.state', 'oauth.json'));
    const missing = join(root, 'missing.md');
    const result = await store.listFromThread('thread', { thread: {
      id: 'thread', cwd: root, turns: [{ items: [
        { id: 'agent', type: 'agentMessage', text: `[missing](${missing})` },
      ] }],
    } });
    assert.equal(result[0].status, 'unavailable');
    await assert.rejects(() => store.read(result[0].id, 0));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('explicit assistant links can return any host regular file outside the thread cwd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-publish-upload-'));
  const uploadFolder = attachmentRoot();
  await mkdir(uploadFolder, { recursive: true });
  const upload = join(uploadFolder, `${randomUUID()}.json`);
  const foreign = join(root, 'other.json');
  const caption = 'CodexMobileUI-diagnostics-2026-11-16T02-59-09-063Z.json';
  await writeFile(upload, '{"result":"ok"}');
  await writeFile(foreign, '{"secret":true}');
  const store = new PublicationStore(join(root, 'state', 'oauth.json'));
  const read = { thread: { id: 'thread', cwd: join(root, 'unrelated-workspace'), turns: [{ items: [
    { id: 'answer', type: 'agentMessage', text: `[下载 ${caption}](${upload})\n[other](${foreign})` },
  ] }] } };
  try {
    const results = await store.listFromThread('thread', read);
    assert.equal(results.length, 2);
    assert.equal(results[0].name, caption, 'display the user-visible original filename');
    assert.equal(results[0].status, 'ready');
    assert.equal(Buffer.from((await store.read(results[0].id, 0)).data, 'base64').toString(), '{"result":"ok"}');
    assert.equal(results[1].status, 'ready', 'host files outside cwd are eligible');
    assert.equal(Buffer.from((await store.read(results[1].id, 0)).data, 'base64').toString(), '{"secret":true}');
  } finally {
    await unlink(upload);
    await rm(root, { recursive: true, force: true });
  }
});

test('large file uploads to Quark without any Gateway data snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-quark-large-'));
  const work = join(root, 'workspace');
  await mkdir(work);
  const source = join(work, 'video.mp4');
  const size = 12 * 1024 * 1024 + 1;
  await writeFile(source, '');
  await truncate(source, size);
  let uploads = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolveWait) => { release = resolveWait; });
  const store = new PublicationStore(join(root, '.state', 'oauth.json'), async (path) => {
    assert.equal(path, source);
    uploads++;
    await wait;
  });
  const native = { thread: { id: 'thread', cwd: work, turns: [{ items: [
    { type: 'agentMessage', id: 'msg', text: `[video](${source})` },
  ] }] } };
  try {
    const [pending] = await store.listFromThread('thread', native);
    assert.equal(pending.status, 'quarkUploading');
    assert.equal(pending.size, size);
    assert.equal(uploads, 0, 'the queue starts after persisting pending state');
    for (let i = 0; i < 30 && uploads === 0; i++) {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.equal(uploads, 1);
    assert.equal((await store.listFromThread('thread', native))[0].status, 'quarkUploading');
    release();
    let result = pending;
    for (let i = 0; i < 30; i++) {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
      result = (await store.listFromThread('thread', native))[0];
      if (result.status === 'quarkUploaded') break;
    }
    assert.equal(result.status, 'quarkUploaded');
    assert.equal(result.destination, '夸克上传文件');
    assert.equal(uploads, 1, 'refresh must not upload a second time');
    const publicationFolder = join(root, '.state', 'published-files');
    assert.deepEqual((await readdir(publicationFolder)).filter((name) => name.endsWith('.data')), []);
    await assert.rejects(() => store.read(result.id, 0));
    await unlink(source);
    assert.equal((await store.listFromThread('thread', native))[0].status, 'quarkUploaded',
      'a confirmed upload remains confirmed even after local deletion');
  } finally { release(); await rm(root, { recursive: true, force: true }); }
});

test('Quark errors become a durable failure card rather than a false download', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-quark-failure-'));
  const source = join(root, 'archive.zip');
  await writeFile(source, '');
  await truncate(source, 12 * 1024 * 1024 + 1);
  let calls = 0;
  const store = new PublicationStore(join(root, '.state', 'oauth.json'), async () => {
    calls++;
    throw new Error('Quark client unavailable');
  });
  const native = { thread: { id: 'thread', cwd: root, turns: [{ items: [
    { type: 'agentMessage', id: 'msg', text: `[archive](${source})` },
  ] }] } };
  try {
    const [first] = await store.listFromThread('thread', native);
    assert.equal(first.status, 'quarkUploading');
    let result = first;
    for (let i = 0; i < 30; i++) {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
      result = (await store.listFromThread('thread', native))[0];
      if (result.status === 'quarkFailed') break;
    }
    assert.equal(result.status, 'quarkFailed');
    assert.equal(calls, 1);
    assert.equal((await store.listFromThread('thread', native))[0].status, 'quarkFailed');
    assert.equal(calls, 1, 'failed uploads must not silently retry after refresh');
  } finally { await rm(root, { recursive: true, force: true }); }
});
