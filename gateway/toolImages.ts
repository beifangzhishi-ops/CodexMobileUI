import { closeSync, lstatSync, openSync, readSync } from 'node:fs';
import { extname } from 'node:path';

const CHUNK = 48 * 1024;
const MAX = 8 * 1024 * 1024;
const extensionMimes: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};

type Reader = (method: string, params: Record<string, unknown>) => Promise<unknown>;
type Obj = Record<string, unknown>;
export type VerifiedToolImage = { path: string; size: number; modified: number };
const obj = (value: unknown): Obj => value && typeof value === 'object' &&
  !Array.isArray(value) ? value as Obj : {};

export function validToolImageRequest(value: unknown): value is {
  threadId: string; turnId: string; itemId: string; offset: number;
} {
  const p = obj(value);
  return Object.keys(p).length === 4 &&
    ['threadId', 'turnId', 'itemId'].every((key) => typeof p[key] === 'string' &&
      /^[a-z\d_.:-]{1,128}$/i.test(p[key] as string)) &&
    Number.isSafeInteger(p.offset) && Number(p.offset) >= 0 && Number(p.offset) < MAX;
}

export async function readNativeToolImage(request: unknown, native: Reader,
  cache?: Map<string, VerifiedToolImage>) {
  if (!validToolImageRequest(request)) throw Error('TOOL_IMAGE_INVALID');
  const { threadId, turnId, itemId, offset } = request;
  const key = JSON.stringify([threadId, turnId, itemId]);
  const known = offset > 0 ? cache?.get(key) : undefined;
  if (offset > 0 && cache && !known) throw Error('TOOL_IMAGE_UNAVAILABLE');
  let path = known?.path ?? '';
  if (!path) {
    const snapshot = obj(await native('thread/read', { threadId, includeTurns: true }));
    const thread = obj(snapshot.thread);
    if (thread.id !== threadId || !Array.isArray(thread.turns)) throw Error('TOOL_IMAGE_UNAVAILABLE');
    for (const rawTurn of thread.turns) {
      const turn = obj(rawTurn);
      if (turn.id !== turnId || !Array.isArray(turn.items)) continue;
      for (const rawItem of turn.items) {
        const item = obj(rawItem);
        if (item.id === itemId && item.type === 'imageView' && typeof item.path === 'string') {
          path = item.path;
        }
      }
    }
  }
  // The path comes only from the verified native tool record, not from the caller.
  if (!/^[A-Za-z]:[\\/]/.test(path) || path.length > 1024 ||
      /[\x00-\x1f]/.test(path) || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(path)) {
    throw Error('TOOL_IMAGE_UNAVAILABLE');
  }
  const mime = extensionMimes[extname(path).toLowerCase()];
  if (!mime) throw Error('TOOL_IMAGE_UNAVAILABLE');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 8 || stat.size > MAX ||
      offset >= stat.size || known &&
      (known.size !== stat.size || known.modified !== stat.mtimeMs))
    throw Error('TOOL_IMAGE_UNAVAILABLE');
  if (cache && offset === 0) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, { path, size: stat.size, modified: stat.mtimeMs });
  }
  const fd = openSync(path, 'r');
  try {
    const data = Buffer.alloc(Math.min(CHUNK, stat.size - offset));
    const count = readSync(fd, data, 0, data.length, offset);
    if (count !== data.length) throw Error('TOOL_IMAGE_CHANGED');
    const head = Buffer.alloc(12);
    if (readSync(fd, head, 0, head.length, 0) < 8) throw Error('TOOL_IMAGE_INVALID');
    const actual = head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
      : head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? 'image/jpeg'
      : head.toString('ascii',0,4) === 'RIFF' && head.toString('ascii',8,12) === 'WEBP' ? 'image/webp'
      : ['GIF87a','GIF89a'].includes(head.toString('ascii',0,6)) ? 'image/gif'
      : head.toString('ascii',0,2) === 'BM' ? 'image/bmp' : '';
    if (actual !== mime) throw Error('TOOL_IMAGE_INVALID');
    return { data: data.toString('base64'), total: stat.size, received: offset + count, mime };
  } finally { closeSync(fd); }
}
