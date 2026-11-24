/** Shared bounds and preview classification for assistant file publications. */
export const PUBLICATION_RETENTION_MS = 72 * 60 * 60 * 1000;
export const PUBLICATION_ORPHAN_TTL_MS = 60 * 60 * 1000;
export const PUBLICATION_CHUNK_BYTES = 64 * 1024;
export const PUBLICATION_TEXT_PREVIEW_BYTES = 256 * 1024;
export const MAX_PUBLICATION_BYTES = 256 * 1024 * 1024;
export const MAX_PUBLICATION_CACHE_BYTES = 512 * 1024 * 1024;
export const MAX_PUBLICATIONS_PER_THREAD = 100;
export const MAX_PUBLICATION_SEQUENCE = Math.ceil(MAX_PUBLICATION_BYTES / PUBLICATION_CHUNK_BYTES) + 2;

export type PublicationStatus = 'ready' | 'unavailable';
export type PublicationPreviewKind =
  | 'markdown' | 'markup' | 'image' | 'document' | 'audio' | 'video' | 'text';

/**
 * Host-owned immutable file metadata returned by `workspace/publication/*`.
 * No client-selected filesystem path is accepted by any publication RPC.
 */
export type PublicationFile = {
  /** Opaque lowercase SHA-256 publication ID; the only identifier mobile submits. */
  id: string;
  /** Native `agentMessage` item ID whose verified Markdown link produced this file. */
  itemId: string;
  /** Native source thread ID whose completed history was verified before publishing. */
  threadId: string;
  /** Native Markdown label when it is a safe filename, otherwise the source basename. */
  name: string;
  /** Host-local deliverable path, returned only to the authenticated client for reveal actions. */
  path: string;
  /** Ready means the immutable snapshot bytes are readable; unavailable never counts as a download. */
  status: PublicationStatus;
  /** Snapshot byte length; zero is used only by a non-cached unavailable result. */
  size: number;
  /** SHA-256 of the immutable snapshot bytes, present when status is ready. */
  hash?: string;
  /** Validated MIME type inferred from the filename or a bounded UTF-8 sample. */
  mime: string;
  /** Inline-preview class; null means the file only exposes a local action. */
  previewKind: PublicationPreviewKind | null;
  /** Epoch milliseconds when this snapshot was created. */
  createdAt: number;
  /** Epoch milliseconds after which the snapshot is no longer readable (72-hour window). */
  expiresAt: number;
  /** Stable failure category returned for one publish attempt and never cached. */
  error?: 'missing' | 'unsafe' | 'tooLarge' | 'unreadable';
};

const imageMimes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const textMimes: Readonly<Record<string, string>> = {
  '.c': 'text/plain',
  '.cc': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.cpp': 'text/plain',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.env': 'text/plain',
  '.go': 'text/plain',
  '.h': 'text/plain',
  '.hpp': 'text/plain',
  '.html': 'text/html',
  '.ini': 'text/plain',
  '.java': 'text/plain',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsx': 'text/javascript',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.mjs': 'text/javascript',
  '.ps1': 'text/plain',
  '.py': 'text/plain',
  '.sh': 'text/plain',
  '.sql': 'application/sql',
  '.svg': 'image/svg+xml',
  '.toml': 'application/toml',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
};

const otherMimes: Readonly<Record<string, string>> = {
  '.aac': 'audio/aac',
  '.avi': 'video/x-msvideo',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.ogv': 'video/ogg',
  '.pdf': 'application/pdf',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
};

export function mimeForFileName(name: string): string | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const extension = dot >= 0 ? lower.slice(dot) : '';
  return imageMimes[extension] ?? textMimes[extension] ?? otherMimes[extension] ?? null;
}

export function previewKindForMime(mime: string | null): PublicationPreviewKind | null {
  const type = (mime ?? '').split(';', 1)[0].trim().toLowerCase();
  if (type === 'text/markdown' || type === 'text/x-markdown') return 'markdown';
  if (type === 'text/html' || type === 'application/xhtml+xml' || type === 'image/svg+xml') return 'markup';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'document';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('text/') ||
      ['application/json', 'application/ld+json', 'application/xml',
        'application/javascript', 'application/x-javascript', 'application/x-yaml',
        'application/yaml', 'application/toml', 'application/sql'].includes(type) ||
      /^application\/[-\w.]+\+(?:json|xml|yaml)$/.test(type)) return 'text';
  return null;
}

export function safePublicationFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').trim().slice(0, 150);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'codex-file';
}

export function isValidPublicationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
