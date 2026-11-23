// Pure browser/server parser: only explicit Markdown links to drive-local
// image files qualify. Text paths, fenced code, and URLs do not.
const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp)$/i;
// Historical assistant messages may embed images from a managed upload folder
// relative to the Web/App Server workdir. No other relative path is allowed.
const MANAGED_IMAGE_PATH = /^\.state[\\/](?:mobile-uploads|web-uploads)[\\/][a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}\.(?:png|jpe?g|webp|gif|bmp)$/i;
const tokenStart = /\[([^\]\r\n]{0,120})\]\(/gy;
export const MAX_ASSISTANT_IMAGES = 8;

function localPath(raw) {
  let value = raw.replace(/^<|>$/g, '');
  if (MANAGED_IMAGE_PATH.test(value)) return value.replace(/\\/g, '/');
  if (/^file:\/\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.host || url.search || url.hash) return null;
      value = decodeURIComponent(url.pathname.replace(/^\/(?=[A-Za-z]:)/, ''));
    } catch { return null; }
  } else {
    if (/^\/[A-Za-z]:[\\/]/.test(value)) value = value.slice(1);
    try { value = decodeURIComponent(value); }
    catch { /* Literal percent signs are permitted in Windows file names. */ }
  }
  if (!/^[A-Za-z]:[\\/]/.test(value) || /[\x00-\x1f]/.test(value) ||
      value.length > 500 || !IMAGE_EXTENSION.test(value)) return null;
  const normalized = value.replace(/\//g, '\\');
  if (/(?:^|\\)\.{1,2}(?:\\|$)/.test(normalized)) return null;
  return normalized;
}

/** Order is identical on browser and host; imageIndex is not a filesystem path. */
export function assistantImageReferences(markdown) {
  if (typeof markdown !== 'string') return [];
  const images = [];
  let fence = null, inlineTicks = 0, lineStart = true;
  for (let i = 0; i < markdown.length && images.length < MAX_ASSISTANT_IMAGES;) {
    const ch = markdown[i];
    if (ch === '\n') { lineStart = true; i++; continue; }
    if (ch === '`') {
      let count = 1;
      while (markdown[i + count] === '`') count++;
      if (fence && lineStart && count >= fence.length) fence = null;
      else if (!fence && !inlineTicks && lineStart && count >= 3) fence = '`'.repeat(count);
      else if (!fence && !inlineTicks) inlineTicks = count;
      else if (!fence && inlineTicks === count) inlineTicks = 0;
      i += count; lineStart = false; continue;
    }
    if (ch !== ' ' && ch !== '\t') lineStart = false;
    if (fence || inlineTicks || ch !== '[' || markdown[i - 1] === '\\') { i++; continue; }
    tokenStart.lastIndex = i;
    const match = tokenStart.exec(markdown);
    if (!match || match.index !== i) { i++; continue; }
    const start = i + match[0].length;
    const angled = markdown[start] === '<';
    let depth = 0, consumed = false;
    for (let end = start; end < markdown.length && end - start <= 850; end++) {
      const c = markdown[end];
      if (c === '\n' || c === '\r') break;
      if (!angled && c === '(') depth++;
      if (c === ')' && (angled ? markdown[end - 1] === '>' : depth === 0)) {
        const path = localPath(markdown.slice(start, end));
        if (path) {
          const isImage = markdown[i - 1] === '!';
          images.push({ path, label: match[1], kind: isImage ? 'image' : 'link',
            start: isImage ? i - 1 : i, end: end + 1 });
          i = end + 1;
          consumed = true;
        }
        break;
      }
      if (!angled && c === ')' && depth > 0) depth--;
    }
    if (!consumed) i++;
  }
  return images;
}

/** Only a presentation rewrite; the actual path is never fetched by the browser. */
export function renderAssistantImageReferences(markdown) {
  const images = assistantImageReferences(markdown);
  let rendered = '', previous = 0;
  images.forEach((ref, index) => {
    rendered += markdown.slice(previous, ref.start);
    const marker = `https://codexmobile.invalid/assistant-image/${index}`;
    rendered += `${ref.kind === 'image' ? '!' : ''}[${ref.label}](${marker})`;
    previous = ref.end;
  });
  return { markdown: rendered + markdown.slice(previous), images };
}
