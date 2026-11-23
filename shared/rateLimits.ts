/** Quota windows are identified by duration, not primary/secondary position. */
export type QuotaWindow = {
  remainingPercent: number;
  resetsAt: number | null;
};

export type RateQuota = {
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  weeklyUnlimited: boolean;
  updatedAt: number;
};

const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;

function parseWindow(value: unknown): { duration: number; window: QuotaWindow } | null {
  const data = obj(value);
  if (!data || typeof data.usedPercent !== 'number' || !Number.isFinite(data.usedPercent) ||
      typeof data.windowDurationMins !== 'number' || !Number.isFinite(data.windowDurationMins)) return null;
  return {
    duration: data.windowDurationMins,
    window: {
      remainingPercent: Math.round(Math.min(100, Math.max(0, 100 - data.usedPercent))),
      resetsAt: typeof data.resetsAt === 'number' && Number.isFinite(data.resetsAt)
        ? data.resetsAt : null,
    },
  };
}

/** Returns null on invalid/missing responses; never mistakes a failed read for unlimited usage. */
export function parseRateQuota(input: unknown, updatedAt = Date.now()): RateQuota | null {
  const payload = obj(input);
  if (!payload) return null;
  const buckets = obj(payload.rateLimitsByLimitId);
  const snapshot = obj(buckets?.codex) ?? obj(payload.rateLimits);
  if (!snapshot) return null;
  const windows = [parseWindow(snapshot.primary), parseWindow(snapshot.secondary)]
    .filter((value): value is NonNullable<typeof value> => value !== null);
  // Some plans expose a weekly bucket as primary with secondary: null.
  const fiveHour = windows.find(({ duration }) => duration >= 240 && duration <= 360)?.window ?? null;
  const weekly = windows.find(({ duration }) => duration >= 10000 && duration <= 10200)?.window ?? null;
  return {
    fiveHour,
    weekly,
    weeklyUnlimited: weekly === null && fiveHour !== null,
    updatedAt,
  };
}

export function quotaPercent(quota: RateQuota | null | undefined, kind: 'fiveHour' | 'weekly'): number | null {
  if (!quota) return null;
  if (kind === 'weekly' && quota.weeklyUnlimited) return 100;
  return quota[kind]?.remainingPercent ?? null;
}

export function quotaResetLabel(quota: RateQuota | null | undefined, kind: 'fiveHour' | 'weekly'): string {
  if (!quota) return '额度尚未读取';
  if (kind === 'weekly' && quota.weeklyUnlimited) return '无每周额度限制';
  const window = quota[kind];
  if (!window) return '服务端未提供此额度';
  if (window.resetsAt == null) return '重置时间未知';
  const date = new Date(window.resetsAt * 1000);
  return Number.isNaN(date.getTime()) ? '重置时间未知' : '重置：' + date.toLocaleString();
}
