export const MAX_VISUALIZE_BYTES = 1024 * 1024;
const MAX_REFERENCES = 8;
const marker = /^ {0,3}\uE200visualize\uE202(\{[^\r\n]{1,1600}\})\uE201[ \t]*\r?$/;

type VisualizeReference = {
  path: string;
  start: number;
  end: number;
  wide: boolean;
  title?: string;
};

export function visualizeReferences(markdown: string): VisualizeReference[] {
  if (!markdown.includes('\uE200visualize\uE202')) return [];
  const references: VisualizeReference[] = [];
  let offset = 0;
  let fence = '';
  for (const line of markdown.split('\n')) {
    const start = offset;
    offset += line.length + 1;
    const delimiter = /^ {0,3}(`{3,}|~{3,})([^\r]*)\r?$/.exec(line);
    if (delimiter) {
      const [, ticks, rest] = delimiter;
      if (fence) {
        if (fence[0] === ticks[0] && ticks.length >= fence.length && !rest.trim()) fence = '';
      } else if (ticks[0] === '~' || !rest.includes('`')) fence = ticks;
      continue;
    }
    if (fence) continue;
    const match = marker.exec(line);
    if (!match) continue;
    try {
      const value = JSON.parse(match[1]);
      if (typeof value.path !== 'string' || value.path.length > 1024 ||
          !/^[A-Za-z]:[\\/][^:\x00-\x1f]+\.html$/i.test(value.path) ||
          /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(value.path)) continue;
      references.push({ path: value.path, start, end: start + line.length,
        wide: value.mode === 'wide',
        title: typeof value.title === 'string' ? value.title.slice(0, 200) : undefined });
    } catch { /* A partial or malformed reference is ordinary message text. */ }
    if (references.length === MAX_REFERENCES) break;
  }
  return references;
}

export function validVisualizeSelection(value: unknown): value is {
  threadId: string; itemId: string; index: number; etag?: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return Object.keys(p).every((key) => ['threadId', 'itemId', 'index', 'etag'].includes(key)) &&
    typeof p.threadId === 'string' && /^[a-f\d-]{36}$/i.test(p.threadId) &&
    typeof p.itemId === 'string' && /^[\w.:-]{1,200}$/.test(p.itemId) &&
    Number.isSafeInteger(p.index) && Number(p.index) >= 0 && Number(p.index) < MAX_REFERENCES &&
    (p.etag === undefined || typeof p.etag === 'string' && /^"[a-f\d]{64}"$/.test(p.etag));
}
