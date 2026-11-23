/** Transport-neutral recognition of explicit local-file Markdown links. */
export type LocalFileLink = {
  label: string;
  path: string;
  location?: string;
  start: number;
  end: number;
};

const linkStart = /\[([^\]\r\n]{1,120})\]\(/gy;

function pathFromDestination(raw: string): Pick<LocalFileLink, 'path' | 'location'> | null {
  let value = raw.replace(/^<|>$/g, '');
  if (/^file:\/\/\//i.test(value)) {
    try {
      const file = new URL(value);
      if (file.host || file.search || file.hash) return null;
      value = decodeURIComponent(file.pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
    } catch { return null; }
  } else {
    // Codex can emit either C:\\... or /C:/... on Windows.
    if (/^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1);
    try { value = decodeURIComponent(value); }
    catch { /* A literal percent sign is valid in a Windows filename. */ }
  }
  const normalized = value.replace(/\//g, '\\');
  // Native Codex can also link to a Windows SMB file. Only actual Markdown
  // link destinations qualify; prose and code are still ignored.
  const localDrive = /^[A-Za-z]:\\/.test(normalized);
  const remoteShare = /^\\\\[^\\/:*?"<>|\x00-\x1f]+\\[^\\/:*?"<>|\x00-\x1f]+\\[^\x00-\x1f]+$/.test(normalized);
  if ((!localDrive && !remoteShare) || /[\x00-\x1f]/.test(normalized)) return null;
  const filenameStart = normalized.lastIndexOf('\\') + 1;
  const filename = normalized.slice(filenameStart);
  const location = /^[^:]+(:[1-9]\d*(?::[1-9]\d*)?)$/.exec(filename)?.[1];
  const path = location ? normalized.slice(0, -location.length) : normalized;
  if (path.slice(localDrive ? 2 : 0).includes(':')) return null;
  return location ? { path, location } : { path };
}

export function localFileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);
}

export function localFileLinks(markdown: string): LocalFileLink[] {
  const links: LocalFileLink[] = [];
  // Ignore fenced and inline code: only actual links in Markdown prose may
  // become host-side file publications.
  let fence: string | null = null;
  let inlineTicks = 0;
  let lineStart = true;
  for (let i = 0; i < markdown.length;) {
    const ch = markdown[i];
    if (ch === '\n') { lineStart = true; i++; continue; }
    if (ch === '`') {
      let ticks = 1;
      while (markdown[i + ticks] === '`') ticks++;
      const sequence = '`'.repeat(ticks);
      if (fence && lineStart && ticks >= fence.length) fence = null;
      else if (!fence && !inlineTicks && lineStart && ticks >= 3) fence = sequence;
      else if (!fence && !inlineTicks) inlineTicks = ticks;
      else if (!fence && inlineTicks === ticks) inlineTicks = 0;
      i += ticks; lineStart = false; continue;
    }
    if (ch !== ' ' && ch !== '\t') lineStart = false;
    if (!fence && !inlineTicks && ch === '[' && markdown[i - 1] !== '!' &&
        markdown[i - 1] !== '\\' && links.length < 20) {
      linkStart.lastIndex = i;
      const match = linkStart.exec(markdown);
      if (match && match.index === i) {
        let consumed = false;
        const start = i + match[0].length;
        const angled = markdown[start] === '<';
        let depth = 0;
        for (let end = start; end < markdown.length && end - start <= 850; end++) {
          const c = markdown[end];
          if (c === '\n' || c === '\r') break;
          if (!angled && c === '(') depth++;
          if (c === ')' && (angled ? markdown[end - 1] === '>' : depth === 0)) {
            const target = pathFromDestination(markdown.slice(start, end));
            if (target) {
              links.push({ label: match[1], ...target, start: i, end: end + 1 });
              i = end + 1;
              consumed = true;
            }
            break;
          }
          if (!angled && c === ')' && depth > 0) depth--;
        }
        if (consumed) continue;
      }
    }
    i++;
  }
  return links;
}

export function localFilePathKey(path: string): string {
  return path.replace(/\//g, '\\').toLowerCase();
}

/** Substitute valid HTTPS syntax only in the presentation layer; never open these URLs. */
export function renderableLocalFileLinks(markdown: string): {
  markdown: string;
  targets: Readonly<Record<string, LocalFileLink>>;
} {
  const targets: Record<string, LocalFileLink> = {};
  let rendered = '';
  let index = 0;
  let previous = 0;
  for (const link of localFileLinks(markdown)) {
    const url = `https://codexmobile.invalid/local-file/${index++}`;
    targets[url] = link;
    rendered += markdown.slice(previous, link.start) + `[${link.label}](${url})`;
    previous = link.end;
  }
  return { markdown: rendered + markdown.slice(previous), targets };
}
