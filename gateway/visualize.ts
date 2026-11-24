import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import {
  MAX_VISUALIZE_BYTES, validVisualizeSelection, visualizeReferences,
} from '../shared/visualizeReferences.js';

type NativeRead = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export async function readVisualize(request: unknown, native: NativeRead) {
  if (!validVisualizeSelection(request)) throw Error('INVALID_VISUALIZE_SELECTION');
  const { threadId, itemId, index, etag } = request;
  const nativeResult = await native('thread/read', { threadId, includeTurns: true }) as {
    thread?: { id?: string; turns?: Array<{ items?: Array<{
      id?: string; type?: string; text?: unknown; content?: Array<{ type?: string; text?: string }>;
    }> }> };
  } | null;
  const thread = nativeResult?.thread;
  if (thread?.id !== threadId || !Array.isArray(thread.turns)) throw Error('VISUALIZE_UNAVAILABLE');
  const item = thread.turns.flatMap((turn) => Array.isArray(turn?.items) ? turn.items : [])
    .find((candidate) => candidate?.id === itemId);
  if (item?.type !== 'agentMessage') throw Error('VISUALIZE_UNAVAILABLE');
  const message = typeof item.text === 'string' ? item.text : Array.isArray(item.content)
    ? item.content.filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text).join('\n') : '';
  const ref = visualizeReferences(message)[index];
  if (!ref) throw Error('VISUALIZE_UNAVAILABLE');

  const before = await lstat(ref.path);
  if (!before.isFile() || before.size < 1 || before.size >= MAX_VISUALIZE_BYTES) {
    throw Error('VISUALIZE_UNAVAILABLE');
  }
  const file = await open(ref.path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino ||
        info.size !== before.size || info.mtimeMs !== before.mtimeMs) throw Error('VISUALIZE_UNAVAILABLE');
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size || (await file.stat()).mtimeMs !== info.mtimeMs) {
      throw Error('VISUALIZE_UNAVAILABLE');
    }
    const content = bytes.subarray(0, length);
    const hash = '"' + createHash('sha256').update(content).digest('hex') + '"';
    if (etag === hash) return { etag: hash };
    const html = new TextDecoder('utf-8', { fatal: true }).decode(content);
    if (html.includes('\0')) throw Error('VISUALIZE_UNAVAILABLE');
    return { etag: hash, data: content.toString('base64') };
  } finally {
    await file.close();
  }
}
