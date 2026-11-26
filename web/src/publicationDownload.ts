import {
  MAX_PUBLICATION_BYTES, PUBLICATION_CHUNK_BYTES, isValidPublicationId,
  safePublicationFileName, type PublicationFile,
} from '../../shared/publicationProtocol';
import type { HostId } from './types';

export type PublishedFile = PublicationFile;
export type PublicationMode = 'download' | 'preview';
export type HostRequest = (
  host: HostId, method: string, params: Record<string, unknown>,
) => Promise<unknown>;
type NativeBridge = { postMessage: (message: string) => void };
type NativeReply = { id: string; seq: number; ok: boolean; message?: string };
type TransferChunk = { encoded: string; bytes: Uint8Array; received: number };

/** Parameters for `workspace/publication/publish` after a user clicks one native link. */
type PublicationPublishParams = {
  /** Native source thread whose current history is read again by the Gateway. */
  threadId: string;
  /** Exact native `agentMessage` item containing the selected Markdown link. */
  itemId: string;
  /** Zero-based index among explicit local-file links in that exact message. */
  linkIndex: number;
};

/** Parameters for one bounded `workspace/publication/read` chunk. */
type PublicationReadParams = {
  /** Opaque 64-hex snapshot ID; clients never submit a filesystem path. */
  id: string;
  /** Safe byte offset; the Gateway returns at most one 64 KiB chunk. */
  offset: number;
};

function bridge(): NativeBridge | null {
  const native = (window as Window & { ReactNativeWebView?: NativeBridge }).ReactNativeWebView;
  return typeof native?.postMessage === 'function' ? native : null;
}

export function hasNativePublicationDownload(): boolean {
  return bridge() !== null;
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
  return {
    encoded: value.data,
    bytes: Uint8Array.from(decoded, (char) => char.charCodeAt(0)),
    received: Number(value.received),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * Transfer already-authorized bytes into the browser download path or the
 * existing Android native sink. The sink receives only an opaque transfer ID
 * and validated chunk bytes; it never receives a host path or RPC method.
 */
async function transferFile(
  file: { id: string; name: string; size: number; mime: string },
  readChunk: (offset: number) => Promise<TransferChunk>,
  onProgress: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!isValidPublicationId(file.id) || !Number.isSafeInteger(file.size) ||
      file.size <= 0 || file.size > MAX_PUBLICATION_BYTES) {
    throw Error('FILE_UNAVAILABLE');
  }
  const native = !!bridge();
  let sequence = 0;
  let started = false;
  const chunks: Uint8Array[] = [];
  try {
    if (native) {
      await nativeExchange({ type: 'publication.start', id: file.id, seq: sequence++,
        name: file.name, size: file.size }, file.id, 0);
      started = true;
    }
    let offset = 0;
    while (offset < file.size) {
      if (signal?.aborted) throw Error('DOWNLOAD_CANCELLED');
      const chunk = await readChunk(offset);
      if (chunk.received <= offset || chunk.received > file.size) {
        throw Error('INVALID_FILE_CHUNK');
      }
      if (native) {
        await nativeExchange({ type: 'publication.chunk', id: file.id, seq: sequence++,
          offset, data: chunk.encoded }, file.id, sequence - 1);
        started = true;
      } else {
        chunks.push(chunk.bytes);
      }
      offset = chunk.received;
      onProgress(offset, file.size);
    }
    if (signal?.aborted) throw Error('DOWNLOAD_CANCELLED');
    if (native) {
      await nativeExchange({ type: 'publication.finish', id: file.id, seq: sequence },
        file.id, sequence);
      started = false;
    } else {
      const blob = new Blob(chunks as BlobPart[], { type: file.mime });
      if (blob.size !== file.size) throw Error('FILE_SIZE_MISMATCH');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safePublicationFileName(file.name);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  } catch (error) {
    if (native && started) {
      await nativeExchange({ type: 'publication.cancel', id: file.id, seq: sequence },
        file.id, sequence).catch(() => undefined);
    }
    throw error;
  }
}

/** Explicitly publish one selected native assistant link; no batch scanning occurs. */
export async function publishAssistantFile(
  host: HostId, threadId: string, itemId: string, linkIndex: number, request: HostRequest,
): Promise<PublishedFile> {
  const params: PublicationPublishParams = { threadId, itemId, linkIndex };
  return parsePublishedFile(await request(host, 'web/publication', {
    method: 'workspace/publication/publish',
    params,
  }), threadId);
}

/** Android keeps the existing chunked system-save bridge and can abort stale work. */
export async function downloadPublication(
  host: HostId, file: PublishedFile, request: HostRequest,
  onProgress: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (file.status !== 'ready' || !isValidPublicationId(file.id) ||
      !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_PUBLICATION_BYTES) {
    throw Error('FILE_UNAVAILABLE');
  }
  await transferFile(file, async (offset) => {
    const params: PublicationReadParams = { id: file.id, offset };
    const result = await request(host, 'web/publication', {
      method: 'workspace/publication/read', params,
    });
    return parseChunk(result, offset, file.size);
  }, onProgress, signal);
}

/**
 * Save an image Blob that was already produced by the native image-read path
 * or selected by the user. `transferId` is an opaque 64-hex sink identifier,
 * not a host path or publication request.
 */
export async function downloadImageBlob(
  blob: Blob, name: string, transferId: string,
  onProgress: (received: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const size = blob.size;
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_PUBLICATION_BYTES ||
      !isValidPublicationId(transferId)) {
    throw Error('FILE_UNAVAILABLE');
  }
  await transferFile({ id: transferId, name, size, mime: blob.type }, async (offset) => {
    const bytes = new Uint8Array(await blob.slice(offset,
      Math.min(size, offset + PUBLICATION_CHUNK_BYTES)).arrayBuffer());
    if (!bytes.length) throw Error('INVALID_FILE_CHUNK');
    return { encoded: bytesToBase64(bytes), bytes, received: offset + bytes.length };
  }, onProgress, signal);
}

export function publicationUrl(host: HostId, id: string, mode: PublicationMode): string {
  if (!isValidPublicationId(id)) throw Error('INVALID_PUBLICATION_ID');
  const url = new URL('/api/publication', window.location.origin);
  url.searchParams.set('host', host);
  url.searchParams.set('id', id);
  url.searchParams.set('mode', mode);
  return url.toString();
}

function parsePublishedFile(value: unknown, threadId: string): PublishedFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('INVALID_PUBLICATION');
  }
  const file = value as Partial<PublishedFile>;
  if (file.threadId !== threadId || !isValidPublicationId(file.id) ||
      typeof file.path !== 'string' || typeof file.name !== 'string' ||
      typeof file.itemId !== 'string' || !Number.isSafeInteger(file.size) ||
      Number(file.size) < 0 || !(file.status === 'ready' || file.status === 'unavailable') ||
      typeof file.mime !== 'string' || !Number.isSafeInteger(file.createdAt) ||
      !Number.isSafeInteger(file.expiresAt) ||
      !(file.previewKind === null || ['markdown', 'markup', 'image', 'document',
        'audio', 'video', 'text'].includes(file.previewKind ?? ''))) {
    throw Error('INVALID_PUBLICATION');
  }
  return file as PublishedFile;
}

export function parsePublishedFiles(value: unknown, threadId: string): PublishedFile[] {
  if (!Array.isArray(value)) throw Error('INVALID_PUBLICATION_LIST');
  return value.slice(0, 100).flatMap((raw) => {
    try { return [parsePublishedFile(raw, threadId)]; }
    catch { return []; }
  });
}
