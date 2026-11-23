import type { HostId } from './types';

const acceptedExtensions = new Set([
  'txt','md','json','jsonl','csv','log','yaml','yml','xml',
  'js','jsx','ts','tsx','py','html','css','sh','ps1','java','kt',
  'rs','go','c','cpp','h','pdf','docx','xlsx','pptx','zip',
]);
const LIMIT = 8 * 1024 * 1024;
const BLOCK = 48 * 1024;

export type UploadedDocument = { name: string; path: string };
export type DocumentRpc = (host: HostId, method: string,
  params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;

export function documentFileAllowed(file: Pick<File, 'name' | 'size'>): boolean {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  return typeof file.name === 'string' && file.name.length >= 1 &&
    file.name.length <= 100 && !/[\\/\x00-\x1f]/.test(file.name) &&
    Boolean(ext && acceptedExtensions.has(ext)) &&
    Number.isSafeInteger(file.size) && file.size >= 1 && file.size <= LIMIT;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

/** Bounded socket upload; the server owns the resulting host-local path. */
export async function uploadDocument(host: HostId, file: File, request: DocumentRpc,
  signal: AbortSignal | undefined, onProgress: (received: number) => void,
): Promise<UploadedDocument> {
  if (!documentFileAllowed(file)) throw Error('DOCUMENT_FORMAT_OR_SIZE_UNSUPPORTED');
  if (signal?.aborted) throw Error('UPLOAD_CANCELLED');
  const started = asObject(await request(host, 'web/attachment/start',
    { name: file.name, size: file.size }, 30000));
  const uploadId = started.uploadId;
  if (typeof uploadId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(uploadId)) throw Error('DOCUMENT_UPLOAD_START_UNCONFIRMED');
  try {
    let offset = 0;
    for (let index = 0; offset < file.size; index++) {
      if (signal?.aborted) throw Error('UPLOAD_CANCELLED');
      const chunk = new Uint8Array(await file.slice(offset, offset + BLOCK).arrayBuffer());
      if (!chunk.byteLength || chunk.byteLength > BLOCK) throw Error('DOCUMENT_READ_FAILED');
      if (signal?.aborted) throw Error('UPLOAD_CANCELLED');
      const encoded = btoa(String.fromCharCode(...chunk));
      const result = asObject(await request(host, 'web/attachment/chunk',
        { uploadId, index, data: encoded }, 30000));
      if (result.received !== offset + chunk.byteLength) throw Error('DOCUMENT_UPLOAD_OFFSET_MISMATCH');
      offset += chunk.byteLength;
      onProgress(offset);
    }
    if (signal?.aborted) throw Error('UPLOAD_CANCELLED');
    const finished = asObject(await request(host, 'web/attachment/finish',
      { uploadId }, 30000));
    if (finished.name !== file.name || finished.kind !== 'file' ||
        typeof finished.path !== 'string' || finished.path.length < 1 ||
        finished.path.length > 400 || /[\r\n]/.test(finished.path)) {
      throw Error('DOCUMENT_UPLOAD_FINISH_UNCONFIRMED');
    }
    if (signal?.aborted) throw Error('UPLOAD_CANCELLED');
    return { name: file.name, path: finished.path };
  } catch (error) {
    // The cancel capability is scoped to this socket's upload, including a
    // just-finished file. It cannot delete an arbitrary host path.
    void request(host, 'web/attachment/cancel', { uploadId }, 5000)
      .catch(() => undefined);
    throw error;
  }
}
