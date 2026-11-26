import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const vite = await createServer({
  root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});
const {
  imageTransferId, imageViewerFileName, saveViewerImage, viewerSourceFromBlob,
} = await vite.ssrLoadModule('/src/imageViewer.ts');
test.after(() => vite.close());

test('image downloads use the validated MIME extension and a usable basename', () => {
  assert.equal(imageViewerFileName('image/png', 'screen shot.jpg', 0), 'screen shot.png');
  assert.match(imageViewerFileName('image/jpeg', undefined,
    Date.UTC(2026, 10, 27, 4, 5, 6, 7)), /^codex-image-\d{8}-\d{9}\.jpg$/);
  assert.throws(() => imageViewerFileName('image/svg+xml', 'unsafe.svg'),
    /IMAGE_FORMAT_OR_SIZE_UNSUPPORTED/);
});

test('image transfer identity is an opaque lowercase SHA-256 value', async () => {
  const id = await imageTransferId('thread:item:0');
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.equal(id, await imageTransferId('thread:item:0'));
});

test('Android image save sends bounded start/chunk/finish sink messages', async (t) => {
  const messages = [];
  const listeners = new Set();
  const native = {
    postMessage(raw) {
      const message = JSON.parse(raw);
      messages.push(message);
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({ detail: { id: message.id, seq: message.seq, ok: true } });
        }
      });
    },
  };
  globalThis.window = {
    location: { origin: 'https://codex.example' },
    ReactNativeWebView: native,
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      if (type === 'codexmobileui:native-reply') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'codexmobileui:native-reply') listeners.delete(listener);
    },
  };
  t.after(() => { delete globalThis.window; });

  const bytes = Buffer.from(PNG_BASE64, 'base64');
  const blob = new Blob([bytes], { type: 'image/png' });
  const source = viewerSourceFromBlob(blob, 'blob:https://codex.example/fixture',
    'history:item:0', 'pixel.jpg');
  const progress = [];
  await saveViewerImage(source, (received, total) => progress.push([received, total]));

  assert.equal(messages.length, 3);
  assert.equal(messages[0].type, 'publication.start');
  assert.match(messages[0].id, /^[a-f0-9]{64}$/);
  assert.equal(messages[0].name, 'pixel.png');
  assert.equal(messages[0].size, bytes.length);
  assert.deepEqual(messages[0].seq, 0);
  assert.equal(messages[1].type, 'publication.chunk');
  assert.equal(messages[1].offset, 0);
  assert.equal(messages[1].data, PNG_BASE64);
  assert.equal(messages[1].seq, 1);
  assert.equal(messages[2].type, 'publication.finish');
  assert.equal(messages[2].seq, 2);
  assert.deepEqual(progress, [[bytes.length, bytes.length]]);
});
