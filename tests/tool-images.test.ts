import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNativeToolImage, validToolImageRequest } from '../gateway/toolImages';

test('native tool image reads require exact imageView item and keep output private', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-image-'));
  const file = join(root, 'preview.png');
  const bytes = Buffer.alloc(70_000);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  writeFileSync(file, bytes);
  let kind = 'imageView', reads = 0;
  const reader = async () => {
    reads++;
    return { thread: { id: 'thread-1', turns: [{
      id: 'turn-1', items: [{ id: 'image-1', type: kind, path: file }],
    }] } };
  };
  const cache = new Map();
  const key = { threadId: 'thread-1', turnId: 'turn-1', itemId: 'image-1' };
  try {
    assert.equal(validToolImageRequest({ ...key, offset: 0 }), true);
    assert.equal(validToolImageRequest({ ...key, path: file, offset: 0 }), false);
    let offset = 0;
    const chunks: Buffer[] = [];
    while (offset < bytes.length) {
      const reply = await readNativeToolImage({ ...key, offset }, reader, cache);
      chunks.push(Buffer.from(reply.data, 'base64'));
      offset = reply.received;
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);
    assert.equal(reads, 1);
    await assert.rejects(() => readNativeToolImage({
      ...key, itemId: 'other', offset: 0,
    }, reader, cache));
    kind = 'commandExecution';
    await assert.rejects(() => readNativeToolImage({ ...key, offset: 0 }, reader, cache));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
