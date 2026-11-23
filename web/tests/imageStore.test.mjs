import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createImageStore, isValidImageRpc } from '../server/imageStore.mjs';
import { assistantImageReferences, renderAssistantImageReferences } from '../server/assistantImageRefs.mjs';

const pngData = (size = 60_000) => {
  const value = Buffer.alloc(size);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(value);
  return value;
};
const testRoot = () => resolve('.tmp', 'web-image-tests', randomUUID());

test('tool image previews use native imageView identity, not caller paths or other tools', async () => {
  const root = testRoot();
  const file = join(root, 'captured.png');
  await mkdir(root, { recursive: true });
  await writeFile(file, pngData(70_000));
  let reads = 0;
  let kind = 'imageView';
  const store = createImageStore(root, async (threadId) => {
    reads++;
    return { thread: { id: threadId, turns: [{ id: 'turn-1', items: [
      { id: 'img-1', type: kind, path: file },
      { id: 'other', type: 'commandExecution', command: file },
    ] }] } };
  });
  try {
    const requested = { threadId: 'thread-1', turnId: 'turn-1', itemId: 'img-1' };
    assert.equal(isValidImageRpc('web/image/toolRead', { ...requested, offset: 0 }), true);
    assert.equal(isValidImageRpc('web/image/toolRead', {
      ...requested, offset: 0, path: file,
    }), false);
    let offset = 0;
    const chunks = [];
    while (offset < 70_000) {
      const part = await store.handle('web/image/toolRead', { ...requested, offset });
      chunks.push(Buffer.from(part.data, 'base64'));
      offset = part.received;
    }
    assert.deepEqual(Buffer.concat(chunks), pngData(70_000));
    assert.equal(reads, 1, 'one native verification per image read');
    for (const target of [
      { ...requested, turnId: 'wrong' },
      { ...requested, itemId: 'other' },
    ]) {
      await assert.rejects(() => store.handle('web/image/toolRead', {
        ...target, offset: 0,
      }), /IMAGE_REQUEST_INVALID/);
    }
    kind = 'commandExecution';
    await assert.rejects(() => store.handle('web/image/toolRead',
      { ...requested, offset: 0 }), /IMAGE_REQUEST_INVALID/);
  } finally {
    store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('image start/chunk/finish read only a native-referenced image in the correct thread', async () => {
  const root = testRoot();
  let imageFile = '';
  const nativeThreadRead = async (threadId) => ({ thread: { id: threadId, turns: [{
    items: [{ type: 'userMessage', id: 'item-1', content: [
      { type: 'text', text: 'picture' }, { type: 'localImage', path: imageFile },
    ] }],
  }] } });
  const store = createImageStore(root, nativeThreadRead);
  try {
    const bytes = pngData();
    const start = await store.handle('web/image/start', { name: 'pasted.png', mime: 'image/png', size: bytes.length });
    assert.ok(start.uploadId);
    await assert.rejects(() => store.handle('web/image/chunk', {
      uploadId: start.uploadId, offset: 10, data: bytes.subarray(0, 32).toString('base64'),
    }));
    let offset = 0;
    while (offset < bytes.length) {
      const part = bytes.subarray(offset, offset + 48 * 1024);
      const ack = await store.handle('web/image/chunk', {
        uploadId: start.uploadId, offset, data: part.toString('base64'),
      });
      assert.equal(ack.received, offset + part.length);
      offset = ack.received;
    }
    const finish = await store.handle('web/image/finish', { uploadId: start.uploadId });
    assert.equal(store.owns(finish.path), true);
    assert.deepEqual(await readFile(finish.path), bytes);
    imageFile = finish.path;
    const slices = [];
    let at = 0;
    while (at < bytes.length) {
      const response = await store.handle('web/image/read', {
        threadId: 'test-thread', itemId: 'item-1', imageIndex: 0, offset: at,
      });
      assert.equal(response.mime, 'image/png');
      assert.equal(response.total, bytes.length);
      slices.push(Buffer.from(response.data, 'base64'));
      at = response.received;
    }
    assert.deepEqual(Buffer.concat(slices), bytes);
    await assert.rejects(() => store.handle('web/image/read', {
      threadId: 'test-thread', itemId: 'other-item', imageIndex: 0, offset: 0,
    }), /IMAGE_REQUEST_INVALID/);
    await assert.rejects(() => store.handle('web/image/read', {
      threadId: 'test-thread', itemId: 'item-1', imageIndex: 1, offset: 0,
    }), /IMAGE_REQUEST_INVALID/);
  } finally {
    store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('historical Android uploads are readable but arbitrary host paths are not', async () => {
  const root = testRoot();
  const file = join(root, 'mobile-uploads', 'historical.jpg');
  const bytes = Buffer.alloc(40);
  Buffer.from([0xff,0xd8,0xff,0xe0]).copy(bytes);
  await mkdir(join(root, 'mobile-uploads'), { recursive: true });
  await writeFile(file, bytes);
  let path = file;
  const store = createImageStore(root, async (threadId) => ({
    thread: { id: threadId, turns: [{ items: [{
      type: 'userMessage', id: 'historical-item',
      content: [{ type: 'localImage', path }],
    }] }] },
  }));
  try {
    const result = await store.handle('web/image/read', {
      threadId: 'mobile-thread', itemId: 'historical-item', imageIndex: 0, offset: 0,
    });
    assert.equal(result.mime, 'image/jpeg');
    assert.deepEqual(Buffer.from(result.data, 'base64'), bytes);
    path = join(root, 'secrets', 'another.jpg');
    await assert.rejects(() => store.handle('web/image/read', {
      threadId: 'mobile-thread', itemId: 'historical-item', imageIndex: 0, offset: 0,
    }), /IMAGE_REQUEST_INVALID/);
  } finally {
    store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('image protocol rejects oversized chunks, external paths and disguised files', async () => {
  assert.equal(isValidImageRpc('web/image/start', { name: '../bad.png', size: 100, mime: 'image/png' }), false);
  assert.equal(isValidImageRpc('web/image/start', { name: 'big.jpg', size: 9 * 1024 * 1024, mime: 'image/jpeg' }), false);
  assert.equal(isValidImageRpc('web/image/read', { threadId: 't', itemId: 'i', imageIndex: 4, offset: 0 }), false);
  assert.equal(isValidImageRpc('web/image/read', { threadId: 't', itemId: 'i', imageIndex: 0, offset: 0, path: 'C:\\hidden' }), false);
  const root = testRoot();
  const store = createImageStore(root, async () => ({ thread: { id: 't', turns: [] } }));
  try {
    const started = await store.handle('web/image/start', { name: 'fake.png', mime: 'image/png', size: 20 });
    await store.handle('web/image/chunk', {
      uploadId: started.uploadId, offset: 0, data: Buffer.alloc(20, 65).toString('base64'),
    });
    await assert.rejects(() => store.handle('web/image/finish', { uploadId: started.uploadId }), /IMAGE_REQUEST_INVALID/);
    await store.handle('web/image/cancel', { uploadId: started.uploadId });
  } finally {
    store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('assistant Markdown image previews are scoped to the native agent item and owning thread', async () => {
  const root = testRoot();
  const file = join(root, 'artifacts', 'preview.png');
  const bytes = pngData(62_000);
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(file, bytes);
  const imageLink = `![示意图](${file})`;
  const link = `[查看图片](${file})`;
  let nativeReads = 0;
  const nativeThreadRead = async (threadId) => {
    nativeReads++;
    return { thread: {
    id: threadId, turns: [{ items: [
      { id: 'agent-1', type: 'agentMessage', text: imageLink + '\n\n' + link },
      { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: imageLink }] },
    ] }],
  } }; };
  const store = createImageStore(root, nativeThreadRead);
  try {
    assert.equal(isValidImageRpc('web/image/assistantRead',
      { threadId: 'thread-a', itemId: 'agent-1', imageIndex: 0, offset: 0 }), true);
    const preview = renderAssistantImageReferences(imageLink + '\n\n' + link);
    assert.equal(preview.images.length, 2);
    assert.deepEqual(preview.images.map((image) => image.kind), ['image','link']);
    assert.equal(preview.images[0].path, file);
    assert.equal(preview.markdown, '![示意图](https://codexmobile.invalid/assistant-image/0)\n\n' + link);
    assert.equal(renderAssistantImageReferences(link + '\n\n' + imageLink).markdown,
      link + '\n\n![示意图](https://codexmobile.invalid/assistant-image/1)');
    let offset = 0;
    const chunks = [];
    while (offset < bytes.length) {
      const result = await store.handle('web/image/assistantRead',
        { threadId: 'thread-a', itemId: 'agent-1', imageIndex: 0, offset });
      assert.equal(result.mime, 'image/png');
      chunks.push(Buffer.from(result.data, 'base64'));
      offset = result.received;
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(nativeReads, 1, 'multi-chunk preview must not repeatedly call thread/read');
    const second = await store.handle('web/image/assistantRead',
      { threadId: 'thread-a', itemId: 'agent-1', imageIndex: 1, offset: 0 });
    assert.equal(second.mime, 'image/png');
    assert.equal(nativeReads, 2, 'a different image index needs its own native reference check');
    await assert.rejects(() => store.handle('web/image/assistantRead', {
      threadId: 'thread-a', itemId: 'user-1', imageIndex: 0, offset: 0,
    }), /IMAGE_REQUEST_INVALID/);
    await assert.rejects(() => store.handle('web/image/assistantRead', {
      threadId: 'thread-a', itemId: 'wrong-item', imageIndex: 0, offset: 0,
    }), /IMAGE_REQUEST_INVALID/);
    await assert.rejects(() => store.handle('web/image/assistantRead', {
      threadId: 'thread-a', itemId: 'agent-1', imageIndex: 2, offset: 0,
    }), /IMAGE_REQUEST_INVALID/);
    await assert.rejects(() => store.handle('web/image/assistantRead', {
      threadId: 'thread-a', itemId: 'agent-1', imageIndex: 0, offset: 0, path: file,
    }), /IMAGE_REQUEST_INVALID/);
    const invalidThread = createImageStore(root, async () =>
      ({ thread: { id: 'someone-else', turns: [{ items: [
        { id: 'agent-1', type: 'agentMessage', text: imageLink },
      ] }] } }));
    try {
      await assert.rejects(() => invalidThread.handle('web/image/assistantRead', {
        threadId: 'thread-a', itemId: 'agent-1', imageIndex: 0, offset: 0,
      }), /IMAGE_REQUEST_INVALID/);
    } finally { invalidThread.dispose(); }
  } finally {
    store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('assistant preview ignores plain paths, code, URLs, and non-image files', async () => {
  const root = testRoot();
  const wrong = join(root, 'secret.png');
  await mkdir(root, { recursive: true });
  await writeFile(wrong, Buffer.from('not a real PNG'));
  try {
    const markdown = [
      'plain path C:\\private\\secret.png',
      '`[inline](C:\\private\\secret.png)`',
      '```md',
      '![fenced](C:\\private\\secret.png)',
      '```',
      '[external](https://example.com/a.png)',
      '[text file](C:\\out\\note.txt)',
      '[fake](C:\\out\\..\\secret.png)',
      '[image](C:\\out\\view.png)',
    ].join('\n');
    assert.deepEqual(assistantImageReferences(markdown).map((ref) => ref.path),
      ['C:\\out\\view.png']);
    assert.deepEqual(assistantImageReferences('![unclosed](C:\\out\\file.png'), []);
    const store = createImageStore(root, async (id) => ({ thread: { id, turns: [{
      items: [{ id: 'agent', type: 'agentMessage', text: `![wrong](${wrong})` }],
    }] } }));
    try {
      await assert.rejects(() => store.handle('web/image/assistantRead', {
        threadId: 'thread', itemId: 'agent', imageIndex: 0, offset: 0,
      }), /IMAGE_REQUEST_INVALID/);
    } finally { store.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('historical assistant images in managed upload folders preview without arbitrary relative reads', async () => {
  const root = testRoot();
  const id = '93134823-5ba5-4ee7-8f2c-c0bb0448d522';
  const relative = `.state/mobile-uploads/${id}.png`;
  const file = join(root, 'mobile-uploads', `${id}.png`);
  await mkdir(join(root, 'mobile-uploads'), { recursive: true });
  await writeFile(file, pngData(100));
  const markdown = `![output](${relative})`;
  const store = createImageStore(root, async (threadId) => ({ thread: {
    id: threadId, turns: [{ items: [{ id: 'agent-output', type: 'agentMessage', text: markdown }] }],
  } }));
  try {
    const references = assistantImageReferences(markdown);
    assert.equal(references.length, 1);
    assert.equal(references[0].path, relative);
    const read = await store.handle('web/image/assistantRead', {
      threadId: 'history', itemId: 'agent-output', imageIndex: 0, offset: 0,
    });
    assert.equal(read.mime, 'image/png');
    assert.equal(read.total, 100);
    assert.deepEqual(assistantImageReferences('![x](.state/mobile-uploads/../../secret.png)'), []);
    assert.deepEqual(assistantImageReferences('![x](.state/mobile-uploads/secret.png)'), []);
    assert.deepEqual(assistantImageReferences('![x](./secret.png)'), []);
  } finally {
    store.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
