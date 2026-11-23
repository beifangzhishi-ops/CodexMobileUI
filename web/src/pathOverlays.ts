import type { HostId, Message } from './types';

export type PathChange = { from: string; to: string };
export type PathOverlay = {
  hostId: HostId;
  threadId: string;
  turnId: string;
  changes: PathChange[];
};

export async function storePathOverlay(overlay: PathOverlay): Promise<void> {
  const response = await fetch('/api/file-path-overlays', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overlay),
  });
  if (!response.ok) throw Error('PATH_OVERLAY_SAVE_FAILED');
}

export async function readPathOverlays(host: HostId, threadId: string): Promise<PathOverlay[]> {
  const response = await fetch('/api/file-path-overlays?host=' + host +
    '&thread=' + encodeURIComponent(threadId), { cache: 'no-store' });
  if (!response.ok) return [];
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) return [];
  return rows.filter((item): item is PathOverlay => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    return record.hostId === host && record.threadId === threadId &&
      typeof record.turnId === 'string' && Array.isArray(record.changes) &&
      record.changes.length <= 24 &&
      record.changes.every((change: unknown) =>
        !!change && typeof change === 'object' &&
        typeof (change as PathChange).from === 'string' &&
        typeof (change as PathChange).to === 'string');
  });
}

/** Only UI content changes. Native Codex snapshots and turn state are untouched. */
export function displayOriginalPaths(messages: Message[], overlays: PathOverlay[]): Message[] {
  const byTurn = new Map(overlays.map((row) => [row.turnId, row.changes]));
  return messages.map((message) => {
    const changes = message.role === 'user' ? byTurn.get(message.turnId ?? '') : undefined;
    if (!changes?.length) return message;
    let content = message.content;
    for (const { from, to } of [...changes].sort((a, b) => b.to.length - a.to.length)) {
      if (to !== from && to.length > 0) content = content.split(to).join(from);
    }
    return content === message.content ? message : { ...message, content };
  });
}
