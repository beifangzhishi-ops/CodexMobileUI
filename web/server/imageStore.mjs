import { randomUUID } from 'node:crypto';
import {
  appendFileSync, closeSync, lstatSync, mkdirSync, openSync, readSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

// One client connection owns its uploads. Never permit a browser-provided path
// to read from or write to the Windows filesystem.
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_CHUNK_BYTES = 48 * 1024;
const MIME_EXT = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'],
  ['image/gif', '.gif'], ['image/bmp', '.bmp'],
]);
const EXT_MIME = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'], ['.bmp', 'image/bmp'],
]);
const MAX_IMAGES_PER_CONNECTION = 64;
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const within = (file, root) => file.toLowerCase().startsWith((root + sep).toLowerCase());
function reject() { throw Error('IMAGE_REQUEST_INVALID'); }

function imageMime(file, namedAs = file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 8 || info.size > IMAGE_MAX_BYTES) reject();
  const extension = EXT_MIME.get(extname(namedAs).toLowerCase());
  if (!extension) reject();
  const fd = openSync(file, 'r');
  const header = Buffer.alloc(16);
  try { readSync(fd, header, 0, header.length, 0); }
  finally { closeSync(fd); }
  let actual = null;
  if (header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) actual = 'image/png';
  else if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) actual = 'image/jpeg';
  else if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') actual = 'image/webp';
  else if (['GIF87a','GIF89a'].includes(header.toString('ascii', 0, 6))) actual = 'image/gif';
  else if (header.toString('ascii', 0, 2) === 'BM') actual = 'image/bmp';
  if (actual !== extension) reject();
  return { mime: actual, size: info.size };
}

export function isValidImageRpc(method, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const keys = Object.keys(p);
  const only = (...expected) => keys.length === expected.length && keys.every((key) => expected.includes(key));
  if (method === 'web/image/start') {
    return only('name','size','mime') && typeof p.name === 'string' &&
      p.name.length >= 1 && p.name.length <= 100 && !/[\\/\x00-\x1f]/.test(p.name) &&
      Number.isSafeInteger(p.size) && p.size >= 8 && p.size <= IMAGE_MAX_BYTES &&
      MIME_EXT.has(p.mime);
  }
  if (method === 'web/image/chunk') {
    return only('uploadId','offset','data') && validId(p.uploadId) &&
      Number.isSafeInteger(p.offset) && p.offset >= 0 && p.offset < IMAGE_MAX_BYTES &&
      typeof p.data === 'string' && p.data.length <= Math.ceil(IMAGE_CHUNK_BYTES * 4 / 3) + 4 &&
      p.data.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(p.data);
  }
  if (method === 'web/image/finish' || method === 'web/image/cancel') {
    return only('uploadId') && validId(p.uploadId);
  }
  if (method === 'web/image/read') {
    return only('threadId','itemId','imageIndex','offset') &&
      validId(p.threadId) && validId(p.itemId) &&
      Number.isInteger(p.imageIndex) && p.imageIndex >= 0 && p.imageIndex < 4 &&
      Number.isInteger(p.offset) && p.offset >= 0 && p.offset < IMAGE_MAX_BYTES;
  }
  return false;
}

export function createImageStore(root, nativeThreadRead) {
  const uploadRoot = resolve(root, 'web-uploads');
  const allowedReadRoots = [uploadRoot, resolve(root, 'mobile-uploads')];
  const partialUploads = new Map();
  const completed = new Set();
  let closed = false;
  const assertOpen = () => { if (closed) reject(); };
  const owns = (path) => typeof path === 'string' && completed.has(path) &&
    within(resolve(path), uploadRoot);
  const removePartial = (upload) => rmSync(upload?.partial, { force: true });

  return {
    owns,
    async handle(method, p) {
      assertOpen();
      if (!isValidImageRpc(method, p)) reject();
      if (method === 'web/image/start') {
        if (partialUploads.size >= 4 || completed.size >= MAX_IMAGES_PER_CONNECTION) reject();
        mkdirSync(uploadRoot, { recursive: true });
        const id = randomUUID(), suffix = MIME_EXT.get(p.mime);
        const file = join(uploadRoot, id + suffix), partial = file + '.part';
        writeFileSync(partial, Buffer.alloc(0), { flag: 'wx' });
        partialUploads.set(id, { partial, file, size: p.size, mime: p.mime, received: 0 });
        return { uploadId: id };
      }
      if (method === 'web/image/chunk') {
        const upload = partialUploads.get(p.uploadId);
        if (!upload || p.offset !== upload.received) reject();
        const bytes = Buffer.from(p.data, 'base64');
        if (!bytes.length || bytes.length > IMAGE_CHUNK_BYTES ||
            upload.received + bytes.length > upload.size) reject();
        appendFileSync(upload.partial, bytes);
        upload.received += bytes.length;
        return { received: upload.received };
      }
      if (method === 'web/image/cancel') {
        const upload = partialUploads.get(p.uploadId);
        if (!upload) reject();
        partialUploads.delete(p.uploadId);
        removePartial(upload);
        return {};
      }
      if (method === 'web/image/finish') {
        const upload = partialUploads.get(p.uploadId);
        if (!upload || upload.received !== upload.size ||
            statSync(upload.partial).size !== upload.size) reject();
        const found = imageMime(upload.partial, upload.file);
        // The completed filename must have the matching extension. Check
        // the bytes before exposing them to App Server as a local image.
        if (found.mime !== upload.mime) reject();
        renameSync(upload.partial, upload.file);
        partialUploads.delete(p.uploadId);
        completed.add(upload.file);
        return { path: upload.file };
      }
      if (method === 'web/image/read') {
        const raw = await nativeThreadRead(p.threadId);
        if (raw?.thread?.id !== p.threadId || !Array.isArray(raw.thread.turns)) reject();
        let path = null;
        for (const turn of raw.thread.turns) {
          for (const item of Array.isArray(turn.items) ? turn.items : []) {
            if (item?.id !== p.itemId || item.type !== 'userMessage' || !Array.isArray(item.content)) continue;
            const images = item.content.filter((part) => part?.type === 'localImage');
            if (images.length <= p.imageIndex) reject();
            path = images[p.imageIndex]?.path;
          }
        }
        if (typeof path !== 'string' || path.length > 500) reject();
        const file = resolve(path);
        if (!allowedReadRoots.some((root) => within(file, root))) reject();
        const { mime, size } = imageMime(file);
        if (p.offset >= size) reject();
        const fd = openSync(file, 'r');
        const bytes = Buffer.alloc(Math.min(IMAGE_CHUNK_BYTES, size - p.offset));
        try { readSync(fd, bytes, 0, bytes.length, p.offset); }
        finally { closeSync(fd); }
        return { data: bytes.toString('base64'), received: p.offset + bytes.length,
          total: size, mime };
      }
      reject();
    },
    dispose() {
      closed = true;
      for (const upload of partialUploads.values()) removePartial(upload);
      partialUploads.clear();
      completed.clear();
    },
  };
}
