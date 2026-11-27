import { validHostId, type HostId } from './types.ts';

export type ContextKind = 'thread' | 'project' | 'message' | 'file' | 'image';
export type ContextTarget = { kind: ContextKind; hostId: HostId; id: string;
  origin?: 'user' | 'assistant'; itemId?: string; linkIndex?: number };

export function contextTargetFromAttributes(kind: string | null, host: string | null,
  id: string | null, origin?: string | null, itemId?: string | null,
  linkIndex?: string | null): ContextTarget | null {
  if (kind !== 'thread' && kind !== 'project' && kind !== 'message' &&
      kind !== 'file' && kind !== 'image') return null;
  if (!validHostId(host) || !id ||
      id.length > (kind === 'file' ? 4096 : 256)) return null;
  const index = linkIndex === undefined || linkIndex === null || linkIndex === ''
    ? undefined : Number(linkIndex);
  return { kind, hostId: host as HostId, id,
    ...(kind === 'file' && (origin === 'user' || origin === 'assistant') ? { origin } : {}),
    ...(kind === 'file' && origin === 'assistant' && itemId &&
      itemId.length <= 200 ? { itemId } : {}),
    ...(kind === 'file' && Number.isSafeInteger(index) && Number(index) >= 0 &&
      Number(index) < 20 ? { linkIndex: Number(index) } : {}),
  };
}

export function gestureMoved(startX: number, startY: number, x: number, y: number) {
  return Math.hypot(x - startX, y - startY) > 12;
}

export function threadLink(base: string, host: HostId, threadId: string): string {
  const url = new URL(base);
  url.hash = '';
  url.search = '';
  url.searchParams.set('host', host);
  url.searchParams.set('thread', threadId);
  return url.toString();
}

export function threadFromLink(urlText: string): { hostId: HostId; id: string } | null {
  try {
    const url = new URL(urlText);
    const host = url.searchParams.get('host');
    const id = url.searchParams.get('thread');
    if (!validHostId(host) || !id || id.length > 256) return null;
    return { hostId: host as HostId, id };
  } catch { return null; }
}

export function readUnreadThreads(raw: string | null): Record<string, true> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, v]) =>
      validHostId(key.split(':', 1)[0]) && /^[^:]+:[^:]{1,256}$/.test(key) && v === true)) as Record<string, true>;
  } catch { return {}; }
}
