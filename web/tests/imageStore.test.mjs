import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createImageStore, isValidImageRpc } from '../server/imageStore.mjs';

const pngData = (size = 60_000) => {
  const value = Buffer.alloc(size);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(value);
  return value;
};
const testRoot = () => resolve('.tmp', 'web-image-tests', randomUUID());

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
