/** Strip native file-change diff bodies before a frame crosses the mobile relay. */
export function redactNativeDiffFrame(raw: string): string {
  if (!raw.includes('"fileChange"') || !raw.includes('"diff"')) return raw;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return raw; }
  let changed = false;
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record.type === 'fileChange' && Array.isArray(record.changes)) {
      const changes = record.changes.map((change) => {
        if (!change || typeof change !== 'object' || Array.isArray(change)) return change;
        const diff = change as Record<string, unknown>;
        if (!Object.hasOwn(diff, 'diff')) return change;
        changed = true;
        const { diff: _discard, ...rest } = diff;
        return rest;
      });
      return { ...record, changes };
    }
    const entries = Object.entries(record).map(([key, child]) => [key, visit(child)] as const);
    return Object.fromEntries(entries);
  }
  const sanitized = visit(parsed);
  return changed ? JSON.stringify(sanitized) : raw;
}
