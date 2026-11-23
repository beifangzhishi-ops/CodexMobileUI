import type { HostId } from './types';

export type PublishedFile = {
  id: string;
  itemId: string;
  threadId: string;
  name: string;
  path: string;
  size: number;
  status: 'ready' | 'unavailable' | 'quarkUploading' | 'quarkUploaded' | 'quarkFailed';
};
export type HostRequest = (
  host: HostId, method: string, params: Record<string, unknown>,
) => Promise<unknown>;
type NativeBridge = { postMessage: (message: string) => void };
type NativeReply = { id: string; seq: number; ok: boolean; message?: string };

function bridge(): NativeBridge | null {
  const native = (window as Window & { ReactNativeWebView?: NativeBridge }).ReactNativeWebView;
  return typeof native?.postMessage === 'function' ? native : null;
}
function nativeExchange(message: Record<string, unknown>, id: string, seq: number): Promise<void> {
  const native = bridge();
  if (!native) return Promise.reject(Error('ANDROID_BRIDGE_MISSING'));
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      window.removeEventListener('codexmobileui:native-reply', receive);
      if (error) reject(error);
      else resolve();
    };
    const receive = (event: Event) => {
      const reply = (event as CustomEvent<NativeReply>).detail;
      if (!reply || reply.id !== id || reply.seq !== seq) return;
      finish(reply.ok ? undefined : Error(reply.message ?? 'ANDROID_DOWNLOAD_FAILED'));
    };
    const timer = window.setTimeout(() => finish(Error('ANDROID_DOWNLOAD_TIMEOUT')),
      message.type === 'publication.finish' ? 300000 : 30000);
    window.addEventListener('codexmobileui:native-reply', receive);
    try { native.postMessage(JSON.stringify(message)); }
    catch { finish(Error('ANDROID_BRIDGE_FAILED')); }
  });
}
function parseChunk(raw: unknown, offset: number, total: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('INVALID_FILE_CHUNK');
  const value = raw as Record<string, unknown>;
  if (typeof value.data !== 'string' || !Number.isSafeInteger(value.received) ||
      !Number.isSafeInteger(value.total) || value.total !== total ||
      Number(value.received) <= offset || Number(value.received) > total ||
      value.data.length > 150000) throw Error('INVALID_FILE_CHUNK');
  const decoded = atob(value.data);
  if (decoded.length !== Number(value.received) - offset) throw Error('INVALID_FILE_CHUNK');
  return { encoded: value.data, bytes: Uint8Array.from(decoded, (char) => char.charCodeAt(0)),
    received: Number(value.received) };
}

/** One download path for browser, WebView Android and a future desktop shell. */
export async function downloadPublication(
  host: HostId, file: PublishedFile, request: HostRequest,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  if (file.status !== 'ready' || !/^[a-f0-9]{64}$/.test(file.id) ||
      !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 12 * 1024 * 1024) {
    throw Error('FILE_UNAVAILABLE');
  }
  const native = !!bridge();
  let sequence = 0;
  const chunks: Uint8Array[] = [];
  if (native) {
    await nativeExchange({ type: 'publication.start', id: file.id, seq: sequence++,
      name: file.name, size: file.size }, file.id, 0);
  }
  let offset = 0;
  while (offset < file.size) {
    const result = await request(host, 'web/publication', {
      method: 'workspace/publication/read', params: { id: file.id, offset },
    });
    const chunk = parseChunk(result, offset, file.size);
    if (native) {
      await nativeExchange({ type: 'publication.chunk', id: file.id, seq: sequence++,
        offset, data: chunk.encoded }, file.id, sequence - 1);
    } else chunks.push(chunk.bytes);
    offset = chunk.received;
    onProgress(offset, file.size);
  }
  if (native) {
    await nativeExchange({ type: 'publication.finish', id: file.id, seq: sequence },
      file.id, sequence);
  } else {
    const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
    if (blob.size !== file.size) throw Error('FILE_SIZE_MISMATCH');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 150) || 'codex-file';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function parsePublishedFiles(value: unknown, threadId: string): PublishedFile[] {
  if (!Array.isArray(value)) throw Error('INVALID_PUBLICATION_LIST');
  return value.slice(0, 20).flatMap((raw): PublishedFile[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const p = raw as Partial<PublishedFile>;
    return p.threadId === threadId && typeof p.id === 'string' &&
      /^[a-f0-9]{64}$/.test(p.id) && typeof p.path === 'string' &&
      typeof p.name === 'string' && typeof p.itemId === 'string' &&
      Number.isSafeInteger(p.size) && Number(p.size) >= 0 &&
      ['ready','unavailable','quarkUploading','quarkUploaded','quarkFailed'].includes(p.status ?? '')
      ? [p as PublishedFile] : [];
  });
}
