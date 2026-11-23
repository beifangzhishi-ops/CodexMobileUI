/** Context occupancy is based on the latest native turn, not lifetime token totals. */
export interface ContextWindowUsage {
  usedTokens: number;
  windowTokens: number;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Parse thread/tokenUsage/updated.params.tokenUsage. Null means no reliable data. */
export function parseContextWindowUsage(raw: unknown): ContextWindowUsage | null {
  const native = asObject(raw);
  const used = asObject(native.last).totalTokens;
  const capacity = native.modelContextWindow;
  if (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0 ||
      typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity <= 0) return null;
  return { usedTokens: used, windowTokens: capacity };
}

export function contextUsagePercent(usage: ContextWindowUsage): number {
  return Math.round(Math.max(0, Math.min(100, 100 * usage.usedTokens / usage.windowTokens)));
}

export function formatContextTokens(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (value >= 10_000) return Math.round(value / 1_000) + 'k';
  if (value >= 1_000) return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(value);
}
