export const ISOLATED_MARKUP_CSP =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";

/** Parse one bounded HTTP byte range without accepting multiple ranges. */
export function parsePublicationRange(header, size) {
  if (header === undefined) return null;
  const match = typeof header === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(header) : null;
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) return false;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) ||
      (last !== null && !Number.isSafeInteger(last))) return false;
  const start = first === null ? Math.max(0, size - last) : first;
  const end = first === null || last === null ? size - 1 : Math.min(last, size - 1);
  return start < size && end >= start && (first !== null || last > 0)
    ? { start, end } : false;
}

/** Stream one inclusive byte range from bounded Gateway chunks. */
export async function streamPublicationRange(session, id, start, end, res) {
  const drain = () => new Promise((resolvePromise, rejectPromise) => {
    const finished = (error) => {
      res.off('drain', success);
      res.off('close', closed);
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const success = () => finished();
    const closed = () => finished(Error('CLIENT_DISCONNECTED'));
    res.once('drain', success);
    res.once('close', closed);
  });
  let offset = start;
  while (offset <= end) {
    if (res.destroyed) throw Error('CLIENT_DISCONNECTED');
    const chunk = await session.request('workspace/publication/read', { id, offset }, 45000);
    if (!chunk || typeof chunk.data !== 'string' || !Number.isSafeInteger(chunk.received) ||
        chunk.received <= offset) throw Error('PUBLICATION_READ_FAILED');
    const bytes = Buffer.from(chunk.data, 'base64');
    const count = Math.min(bytes.length, end - offset + 1);
    if (count <= 0 || bytes.length !== chunk.received - offset) throw Error('PUBLICATION_READ_FAILED');
    if (!res.write(bytes.subarray(0, count))) await drain();
    offset += count;
  }
}
