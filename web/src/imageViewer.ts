import {
  safePublicationFileName,
} from '../../shared/publicationProtocol';
import { downloadImageBlob } from './publicationDownload';

export const MAX_VIEWER_IMAGE_BYTES = 8 * 1024 * 1024;

const imageExtensions: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

export type ImageViewerSource = {
  /** The page-owned blob URL currently displayed by the viewer. */
  url: string;
  /** Immutable original bytes already loaded from the native image reader or file picker. */
  blob: Blob;
  /** Windows-safe name with an extension matching the validated image bytes. */
  name: string;
  /** Stable local identity used only to derive an opaque native sink ID. */
  key: string;
};

export function imageViewerExtension(mime: string): string | null {
  return imageExtensions[mime.toLowerCase()] ?? null;
}

function timestampSuffix(now: number): string {
  const date = new Date(now);
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return [
    date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate()), '-',
    pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds()), pad(date.getMilliseconds(), 3),
  ].join('');
}

/** Keep a useful original basename while forcing the validated MIME extension. */
export function imageViewerFileName(mime: string, suggestedName?: string,
  now = Date.now()): string {
  const extension = imageViewerExtension(mime);
  if (!extension) throw Error('IMAGE_FORMAT_OR_SIZE_UNSUPPORTED');
  const suggestedBase = suggestedName
    ?.replace(/[\\/]/g, '_')
    .replace(/\.[^.]+$/, '')
    .trim()
    .slice(0, 100);
  const safeBase = safePublicationFileName(suggestedBase || 'codex-image-' + timestampSuffix(now))
    .replace(/[. ]+$/g, '') || 'codex-image-' + timestampSuffix(now);
  return safeBase + '.' + extension;
}

export function validateViewerImageBlob(blob: Blob): void {
  if (!imageViewerExtension(blob.type) || blob.size < 8 ||
      blob.size > MAX_VIEWER_IMAGE_BYTES) {
    throw Error('IMAGE_FORMAT_OR_SIZE_UNSUPPORTED');
  }
}

export function viewerSourceFromBlob(blob: Blob, url: string, key: string,
  suggestedName?: string): ImageViewerSource {
  validateViewerImageBlob(blob);
  return { url, blob, key, name: imageViewerFileName(blob.type, suggestedName) };
}

/**
 * Context-menu actions only retain the page-owned blob URL, not the Blob
 * object. Re-open that exact object URL after validating it belongs to this
 * page and still resolves to a bounded image. No host URL or path is fetched.
 */
export async function viewerSourceFromBlobUrl(url: string): Promise<ImageViewerSource> {
  if (!url.startsWith('blob:' + window.location.origin + '/')) {
    throw Error('INVALID_IMAGE_SOURCE');
  }
  const blob = await (await fetch(url)).blob();
  return viewerSourceFromBlob(blob, url, 'blob-url:' + url);
}

export async function imageTransferId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function saveViewerImage(source: ImageViewerSource,
  onProgress: (received: number, total: number) => void,
  signal?: AbortSignal): Promise<void> {
  validateViewerImageBlob(source.blob);
  const id = await imageTransferId(source.key);
  await downloadImageBlob(source.blob, source.name, id, onProgress, signal);
}
