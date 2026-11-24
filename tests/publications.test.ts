import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicationStore, explicitFileLinks } from '../gateway/publications';
import {
  MAX_PUBLICATION_BYTES, PUBLICATION_RETENTION_MS, mimeForFileName, previewKindForMime,
} from '../shared/publicationProtocol';

function nativeRead(threadId: string, cwd: string, itemId: string, text: string) {
  return { thread: { id: threadId, cwd, turns: [{ items: [
    { id: 'other', type: 'agentMessage', text: '[other](C:\\not-selected.txt)' },
    { id: itemId, type: 'agentMessage', text },
  ] }] } };
}

test('only explicit assistant file links qualify; absolute path in prose is ignored', () => {
  assert.deepEqual(explicitFileLinks('普通路径 C:\\Repo\\report.md'), []);
  assert.deepEqual(explicitFileLinks('[report](C:\\Repo\\report.md)'), [
    { name: 'report.md', path: 'C:\\Repo\\report.md' },
  ]);
  assert.deepEqual(explicitFileLinks('[别名.md](/C:/Repo/report.md:261) [next](/C:/Repo/next.txt)'), [
    { name: 'report.md', path: 'C:\\Repo\\report.md' },
    { name: 'next.txt', path: 'C:\\Repo\\next.txt' },
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

test('thread reads do not publish; one selected native link creates one snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-publish-selection-'));
  const state = join(root, '.state');
  const first = join(root, 'first.md');
  const second = join(root, 'second.txt');
  await mkdir(state);
  await writeFile(first, '# first\n');
  await writeFile(second, '  spaced text\n\nlast\n');
  const store = new PublicationStore(join(state, 'oauth.json'));
  const read = nativeRead('thread-a', root, 'answer', `[first](${first})\n[second](${second})`);
  try {
    assert.deepEqual(await store.listForThread('thread-a'), []);
    const published = await store.publishFromThread('thread-a', 'answer', 1, read);
    assert.equal(published.itemId, 'answer');
    assert.equal(published.name, 'second.txt');
    assert.equal(published.status, 'ready');
    assert.equal(published.previewKind, 'text');
    assert.equal(Buffer.from((await store.read(published.id, 0)).data, 'base64').toString(),
      '  spaced text\n\nlast\n');
    assert.equal((await store.listForThread('thread-a')).length, 1);
    assert.equal((await store.listForThread('other-thread')).length, 0);
    await assert.rejects(() => store.publishFromThread('thread-a', 'absent', 0, read),
      /PUBLICATION_SELECTION_INVALID/);
    await assert.rejects(() => store.publishFromThread('thread-a', 'answer', 2, read),
      /PUBLICATION_SELECTION_NOT_FOUND/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('published snapshots are immutable, private and valid for the retention window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-publish-snapshot-'));
  const state = join(root, '.state');
  const path = join(root, 'result.md');
  await mkdir(state);
  await writeFile(path, '# original\n');
  const store = new PublicationStore(join(state, 'oauth.json'));
  const read = nativeRead('thread', root, 'message', `[result](${path})`);
  try {
    const first = await store.publishFromThread('thread', 'message', 0, read);
    assert.equal(first.expiresAt - first.createdAt, PUBLICATION_RETENTION_MS);
    await writeFile(path, '# changed\n');
    await unlink(path);
    const reopened = await store.stat(first.id);
    assert.deepEqual(reopened, first);
    assert.equal(Buffer.from((await store.read(first.id, 0)).data, 'base64').toString(),
      '# original\n');
    const metadata = join(state, 'published-files', `${first.id}.json`);
    await writeFile(metadata, JSON.stringify({ ...first, expiresAt: Date.now() - 1 }));
    assert.deepEqual(await store.listForThread('thread'), []);
    assert.equal(await store.get(first.id), null);
    assert.deepEqual((await readdir(join(state, 'published-files')))
      .filter((name) => name.startsWith(first.id)), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unreadable and oversized selections return visible unavailable states', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-publish-unavailable-'));
  const missing = join(root, 'missing.md');
  const large = join(root, 'large.bin');
  await writeFile(large, '');
  await truncate(large, MAX_PUBLICATION_BYTES + 1);
  const store = new PublicationStore(join(root, '.state', 'oauth.json'));
  try {
    const absent = await store.publishFromThread('thread', 'answer',
      0, nativeRead('thread', root, 'answer', `[missing](${missing})`));
    assert.equal(absent.status, 'unavailable');
    assert.equal(absent.error, 'missing');
    const tooLarge = await store.publishFromThread('thread', 'answer',
      0, nativeRead('thread', root, 'answer', `[large](${large})`));
    assert.equal(tooLarge.status, 'unavailable');
    assert.equal(tooLarge.error, 'tooLarge');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('explicit links may target any regular host file and preserve text whitespace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-publish-hostfile-'));
  const source = join(root, 'unknown.extension');
  await writeFile(source, 'line one\r\n  line two\r\n');
  const store = new PublicationStore(join(root, 'state', 'oauth.json'));
  try {
    const result = await store.publishFromThread('thread', 'answer',
      0, nativeRead('thread', join(root, 'different-workspace'), 'answer', `[notes](${source})`));
    assert.equal(result.status, 'ready');
    assert.equal(result.mime, 'text/plain');
    assert.equal(result.previewKind, 'text');
    assert.equal(Buffer.from((await store.read(result.id, 0)).data, 'base64').toString(),
      'line one\r\n  line two\r\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an available legacy Quark link re-publishes as a private immutable snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-publish-legacy-'));
  const state = join(root, '.state');
  const published = join(state, 'published-files');
  const source = join(root, 'legacy.txt');
  await mkdir(published, { recursive: true });
  await writeFile(source, 'private snapshot');
  const threadId = '00000000-0000-4000-8000-000000000001';
  const itemId = 'legacy-item';
  const id = createHash('sha256').update(JSON.stringify([threadId, itemId, source])).digest('hex');
  await writeFile(join(published, id + '.json'), JSON.stringify({
    id, itemId, threadId, name: 'legacy.txt', path: source, status: 'quarkUploaded',
    size: 16, destination: '夸克上传文件',
  }));
  const store = new PublicationStore(join(state, 'oauth.json'));
  try {
    const result = await store.publishFromThread(threadId, itemId, 0,
      nativeRead(threadId, root, itemId, `[legacy](${source})`));
    assert.equal(result.id, id);
    assert.equal(result.status, 'ready');
    assert.equal(Buffer.from((await store.read(id, 0)).data, 'base64').toString(),
      'private snapshot');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preview MIME classification covers documents, media, markup and text', () => {
  assert.equal(previewKindForMime(mimeForFileName('page.html')), 'markup');
  assert.equal(previewKindForMime(mimeForFileName('drawing.svg')), 'markup');
  assert.equal(previewKindForMime(mimeForFileName('paper.pdf')), 'document');
  assert.equal(previewKindForMime(mimeForFileName('audio.mp3')), 'audio');
  assert.equal(previewKindForMime(mimeForFileName('movie.mp4')), 'video');
  assert.equal(previewKindForMime('application/octet-stream'), null);
});
