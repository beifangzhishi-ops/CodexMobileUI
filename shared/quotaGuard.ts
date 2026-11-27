export const QUOTA_GUARD_THRESHOLD_PERCENT = 3;

export function isQuotaGuardThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}

export type QuotaHostId = '6v' | 'noha';
export type QuotaWindowSlot = 'primary' | 'secondary';
export type QuotaInterruptState = 'requested' | 'retrying' | 'confirmed' | 'failed';

export type QuotaWindowReading = {
  limitId: string;
  limitName: string | null;
  slot: QuotaWindowSlot;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
  baseKey: string;
  windowKey: string;
};

export type QuotaGuardTrigger = QuotaWindowReading & {
  firstDetectedAt: number;
  lastSeenAt: number;
};

export type QuotaInterrupt = {
  threadId: string;
  turnId: string;
  state: QuotaInterruptState;
  attempts: number;
  requestedAt: number;
  confirmedAt: number | null;
  reason: string | null;
};

export type QuotaGuardRuntime = {
  version: 1;
  hostId: QuotaHostId;
  revision: number;
  updatedAt: number;
  settingRevision: number;
  enabled: boolean;
  nativeStatus: 'connecting' | 'online' | 'offline';
  lastReadAt: number | null;
  lastReadError: string | null;
  discovery: 'idle' | 'complete' | 'incomplete';
  triggers: QuotaGuardTrigger[];
  interrupts: QuotaInterrupt[];
};

export type QuotaGuardSetting = {
  thresholdPercent: number;
  enabled: boolean;
  revision: number;
  updatedAt: number;
  syncedAt: number | null;
  pending: boolean;
  reason: string | null;
};

export type QuotaGuardHostView = {
  hostId: QuotaHostId;
  status: 'off' | 'ready' | 'guarded' | 'interrupting' | 'confirmed' | 'failed' | 'degraded' | 'pending';
  readAt: number | null;
  triggeredCount: number;
  reason: string | null;
};

export type QuotaGuardSharedState = {
  version: 1;
  enabled: boolean;
  revision: number;
  updatedAt: number;
  authoritativeHost: '6v';
  thresholdPercent: number;
  status: 'off' | 'ready' | 'guarded' | 'interrupting' | 'confirmed' | 'failed' | 'degraded' | 'pending';
  triggerReason: string | null;
  sync: {
    state: 'current' | 'pending';
    syncedAt: number | null;
    reason: string | null;
  };
  hosts: Partial<Record<QuotaHostId, QuotaGuardHostView>>;
};

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const boundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const hostId = (value: unknown): value is QuotaHostId => value === '6v' || value === 'noha';
const slot = (value: unknown): value is QuotaWindowSlot => value === 'primary' || value === 'secondary';

function windowIdentity(limitId: string, windowSlot: QuotaWindowSlot,
  duration: number | null, resetsAt: number | null): { baseKey: string; windowKey: string } {
  const baseKey = [limitId, windowSlot, duration ?? 'unknown'].join(':');
  return { baseKey, windowKey: baseKey + ':' + (resetsAt ?? 'unknown') };
}

function parseWindow(limitId: string, limitName: string | null, windowSlot: QuotaWindowSlot,
  value: unknown): QuotaWindowReading | null {
  const data = object(value);
  if (!data || !finite(data.usedPercent) || data.usedPercent < 0 || data.usedPercent > 1_000_000) return null;
  const duration = finite(data.windowDurationMins) && data.windowDurationMins > 0
    ? data.windowDurationMins : null;
  const resetsAt = finite(data.resetsAt) && data.resetsAt > 0 ? data.resetsAt : null;
  const identity = windowIdentity(limitId, windowSlot, duration, resetsAt);
  return {
    limitId, limitName, slot: windowSlot,
    usedPercent: data.usedPercent,
    remainingPercent: Math.max(0, 100 - data.usedPercent),
    windowDurationMins: duration,
    resetsAt,
    ...identity,
  };
}

/**
 * Read every valid primary/secondary window from the native full snapshot.
 * This intentionally does not use the display parser, which only maps Codex's
 * five-hour/weekly buckets and rounds the remaining percentage.
 */
export function parseNativeQuotaWindows(input: unknown): QuotaWindowReading[] {
  const payload = object(input);
  if (!payload) return [];
  const readings = new Map<string, QuotaWindowReading>();
  const byId = object(payload.rateLimitsByLimitId);
  if (byId) {
    for (const [key, value] of Object.entries(byId)) {
      const snapshot = object(value);
      if (!snapshot) continue;
      const limitId = boundedString(snapshot.limitId, 200) ? snapshot.limitId : key.slice(0, 200);
      const limitName = boundedString(snapshot.limitName, 200) ? snapshot.limitName : null;
      if (!limitId) continue;
      for (const windowSlot of ['primary', 'secondary'] as const) {
        const parsed = parseWindow(limitId, limitName, windowSlot, snapshot[windowSlot]);
        if (parsed) readings.set(parsed.windowKey, parsed);
      }
    }
  }
  const legacy = object(payload.rateLimits);
  if (legacy && (!byId || Object.keys(byId).length === 0)) {
    const limitId = boundedString(legacy.limitId, 200) ? legacy.limitId : 'default';
    const limitName = boundedString(legacy.limitName, 200) ? legacy.limitName : null;
    for (const windowSlot of ['primary', 'secondary'] as const) {
      const parsed = parseWindow(limitId, limitName, windowSlot, legacy[windowSlot]);
      if (parsed) readings.set(parsed.windowKey, parsed);
    }
  }
  return [...readings.values()];
}

export function mergeQuotaGuardTriggers(existing: readonly QuotaGuardTrigger[],
  readings: readonly QuotaWindowReading[], observedAt = Date.now(),
  thresholdPercent = QUOTA_GUARD_THRESHOLD_PERCENT): QuotaGuardTrigger[] {
  const retained = new Map<string, QuotaGuardTrigger>();
  for (const trigger of existing) {
    if (!trigger || !boundedString(trigger.windowKey, 1000) ||
        !boundedString(trigger.baseKey, 1000) || !finite(trigger.usedPercent)) continue;
    retained.set(trigger.windowKey, trigger);
  }
  const byBase = new Map<string, QuotaWindowReading[]>();
  for (const reading of readings) {
    const group = byBase.get(reading.baseKey) ?? [];
    group.push(reading);
    byBase.set(reading.baseKey, group);
  }
  for (const trigger of [...retained.values()]) {
    if (observedAt < trigger.lastSeenAt) continue;
    const exact = readings.find((reading) => reading.windowKey === trigger.windowKey);
    const freshSameWindow = exact && exact.remainingPercent > thresholdPercent;
    const resetWindow = !exact && (byBase.get(trigger.baseKey) ?? []).find((reading) =>
      reading.remainingPercent > thresholdPercent &&
      reading.resetsAt !== null && trigger.resetsAt !== null &&
      reading.resetsAt > trigger.resetsAt);
    if (freshSameWindow || resetWindow) retained.delete(trigger.windowKey);
  }
  for (const reading of readings) {
    if (reading.remainingPercent > thresholdPercent) continue;
    const prior = retained.get(reading.windowKey);
    if (prior && observedAt < prior.lastSeenAt) continue;
    retained.set(reading.windowKey, {
      ...reading,
      firstDetectedAt: prior?.firstDetectedAt ?? observedAt,
      lastSeenAt: observedAt,
    });
  }
  return [...retained.values()].sort((a, b) => a.windowKey.localeCompare(b.windowKey));
}

export function quotaWindowLabel(window: Pick<QuotaGuardTrigger,
  'limitName' | 'limitId' | 'windowDurationMins' | 'remainingPercent'>): string {
  const duration = window.windowDurationMins;
  const kind = duration !== null && Math.abs(duration - 300) <= 15
    ? '5 小时额度'
    : duration !== null && Math.abs(duration - 10080) <= 30
      ? '每周额度'
      : duration !== null ? duration + ' 分钟额度' : '原生额度';
  const name = window.limitName || window.limitId;
  return name + ' · ' + kind + '剩余 ' + window.remainingPercent.toFixed(1) + '%';
}

export function parseQuotaGuardRuntime(input: unknown, expectedHost?: QuotaHostId): QuotaGuardRuntime | null {
  const data = object(input);
  if (!data || data.version !== 1 || !hostId(data.hostId) ||
      (expectedHost && data.hostId !== expectedHost) ||
      !finite(data.updatedAt) || data.updatedAt < 0 || !Number.isSafeInteger(data.revision) ||
      Number(data.revision) < 0 || !Number.isSafeInteger(data.settingRevision) ||
      Number(data.settingRevision) < 0 || typeof data.enabled !== 'boolean' ||
      !['connecting', 'online', 'offline'].includes(String(data.nativeStatus)) ||
      !(data.lastReadAt === null || finite(data.lastReadAt) && data.lastReadAt >= 0) ||
      !(data.lastReadError === null ||
        typeof data.lastReadError === 'string' && data.lastReadError.length <= 200) ||
      !['idle', 'complete', 'incomplete'].includes(String(data.discovery)) ||
      !Array.isArray(data.triggers) || data.triggers.length > 64 ||
      !Array.isArray(data.interrupts) || data.interrupts.length > 128) return null;
  const triggers: QuotaGuardTrigger[] = [];
  for (const value of data.triggers) {
    const item = object(value);
    if (!item || !boundedString(item.limitId, 200) ||
        !(item.limitName === null || boundedString(item.limitName, 200)) ||
        !slot(item.slot) || !finite(item.usedPercent) ||
        item.usedPercent < 0 || item.usedPercent > 1_000_000 ||
        !finite(item.remainingPercent) || item.remainingPercent < 0 || item.remainingPercent > 100 ||
        !(item.windowDurationMins === null ||
          finite(item.windowDurationMins) && item.windowDurationMins > 0) ||
        !(item.resetsAt === null || finite(item.resetsAt) && item.resetsAt > 0) ||
        !boundedString(item.baseKey, 1000) || !boundedString(item.windowKey, 1000) ||
        !finite(item.firstDetectedAt) || item.firstDetectedAt < 0 ||
        !finite(item.lastSeenAt) || item.firstDetectedAt > item.lastSeenAt) return null;
    const identity = windowIdentity(item.limitId, item.slot,
      item.windowDurationMins as number | null, item.resetsAt as number | null);
    if (item.baseKey !== identity.baseKey || item.windowKey !== identity.windowKey) return null;
    triggers.push(item as QuotaGuardTrigger);
  }
  const interrupts: QuotaInterrupt[] = [];
  for (const value of data.interrupts) {
    const item = object(value);
    if (!item || !boundedString(item.threadId, 200) || !boundedString(item.turnId, 200) ||
        !['requested', 'retrying', 'confirmed', 'failed'].includes(String(item.state)) ||
        !Number.isSafeInteger(item.attempts) || Number(item.attempts) < 0 ||
        !finite(item.requestedAt) || item.requestedAt < 0 ||
        !(item.confirmedAt === null ||
          finite(item.confirmedAt) && item.confirmedAt >= item.requestedAt) ||
        item.state === 'confirmed' && item.confirmedAt === null ||
        !(item.reason === null || boundedString(item.reason, 200))) return null;
    interrupts.push(item as QuotaInterrupt);
  }
  return {
    version: 1, hostId: data.hostId, revision: Number(data.revision),
    updatedAt: data.updatedAt,
    settingRevision: Number(data.settingRevision), enabled: data.enabled,
    nativeStatus: data.nativeStatus as QuotaGuardRuntime['nativeStatus'],
    lastReadAt: data.lastReadAt as number | null,
    lastReadError: data.lastReadError as string | null,
    discovery: data.discovery as QuotaGuardRuntime['discovery'],
    triggers, interrupts,
  };
}

export function quotaGuardGuardedMethod(method: string): boolean {
  return [
    'turn/start', 'turn/steer', 'thread/queue/add', 'thread/queue/start',
    'thread/goal/set', 'thread/compact/start',
  ].includes(method);
}

export function quotaGuardHostView(runtime: QuotaGuardRuntime | null,
  expectedHost: QuotaHostId, now = Date.now()): QuotaGuardHostView {
  if (!runtime || runtime.hostId !== expectedHost) {
    return { hostId: expectedHost, status: 'pending', readAt: null,
      triggeredCount: 0, reason: '等待这台电脑的额度状态' };
  }
  const active = runtime.interrupts.filter((item) => item.state === 'requested' || item.state === 'retrying');
  const failed = runtime.interrupts.filter((item) => item.state === 'failed');
  const confirmed = runtime.interrupts.filter((item) => item.state === 'confirmed');
  const reason = runtime.triggers[0]
    ? quotaWindowLabel(runtime.triggers[0]) +
      (runtime.discovery === 'incomplete' ? '；活跃回合扫描不完整' : '')
    : runtime.lastReadError;
  const fresh = runtime.nativeStatus === 'online' && runtime.lastReadAt !== null &&
    now - runtime.lastReadAt <= 150_000;
  const status: QuotaGuardHostView['status'] = !runtime.enabled ? 'off'
    : runtime.triggers.length > 0 && failed.length > 0 ? 'failed'
      : runtime.triggers.length > 0 && active.length > 0 ? 'interrupting'
        : runtime.triggers.length > 0 && confirmed.length > 0 ? 'confirmed'
          : runtime.triggers.length > 0 ? 'guarded'
            : fresh ? 'ready' : 'degraded';
  return {
    hostId: expectedHost, status, readAt: runtime.lastReadAt,
    triggeredCount: runtime.triggers.length, reason,
  };
}

export function buildQuotaGuardState(setting: QuotaGuardSetting,
  syncPending: boolean, syncReason: string | null, syncedAt: number | null,
  runtimes: Partial<Record<QuotaHostId, QuotaGuardRuntime | null>>): QuotaGuardSharedState {
  const hosts = {
    '6v': quotaGuardHostView(runtimes['6v'] ?? null, '6v'),
    noha: quotaGuardHostView(runtimes.noha ?? null, 'noha'),
  } satisfies Record<QuotaHostId, QuotaGuardHostView>;
  const triggered = Object.values(hosts).flatMap((host) =>
    host.triggeredCount > 0 && host.reason ? [{ host, reason: host.reason }] : []);
  const activeInterrupt = Object.values(hosts).some((host) => host.status === 'interrupting');
  const failed = Object.values(hosts).some((host) => host.status === 'failed');
  const confirmed = Object.values(hosts).some((host) => host.status === 'confirmed');
  const degraded = Object.values(hosts).some((host) =>
    host.status === 'degraded' || host.status === 'pending');
  let status: QuotaGuardSharedState['status'];
  if (!setting.enabled) status = 'off';
  else if (triggered.length > 0) status = failed ? 'failed'
    : activeInterrupt ? 'interrupting' : confirmed ? 'confirmed' : 'guarded';
  else if (syncPending || degraded) status = syncPending ? 'pending' : 'degraded';
  else status = 'ready';
  const triggerReason = triggered.length === 0 ? null
    : triggered.slice(0, 3).map(({ host, reason }) => host.hostId + ' · ' + reason).join('；') +
      (triggered.length > 3 ? '；另有 ' + (triggered.length - 3) + ' 台电脑触发' : '');
  return {
    version: 1, enabled: setting.enabled, revision: setting.revision,
    updatedAt: setting.updatedAt, authoritativeHost: '6v', thresholdPercent: setting.thresholdPercent,
    status, triggerReason,
    sync: { state: syncPending ? 'pending' : 'current', syncedAt,
      reason: syncReason },
    hosts,
  };
}

export function parseQuotaGuardSharedState(input: unknown): QuotaGuardSharedState | null {
  const data = object(input);
  if (!data || data.version !== 1 || data.authoritativeHost !== '6v' ||
      !isQuotaGuardThreshold(data.thresholdPercent) || typeof data.enabled !== 'boolean' ||
      !Number.isSafeInteger(data.revision) || !finite(data.updatedAt) ||
      !['off', 'ready', 'guarded', 'interrupting', 'confirmed', 'failed', 'degraded', 'pending']
        .includes(String(data.status)) ||
      !(data.triggerReason === null || typeof data.triggerReason === 'string') ||
      !object(data.sync) || !object(data.hosts)) return null;
  const sync = data.sync as Record<string, unknown>;
  if (!['current', 'pending'].includes(String(sync.state)) ||
      !(sync.syncedAt === null || finite(sync.syncedAt)) ||
      !(sync.reason === null || typeof sync.reason === 'string')) return null;
  const hostsValue = data.hosts as Record<string, unknown>;
  const hosts: Partial<Record<QuotaHostId, QuotaGuardHostView>> = {};
  for (const id of ['6v', 'noha'] as const) {
    const value = object(hostsValue[id]);
    if (!value || value.hostId !== id ||
        !['off', 'ready', 'guarded', 'interrupting', 'confirmed', 'failed', 'degraded', 'pending']
          .includes(String(value.status)) ||
        !Number.isSafeInteger(value.triggeredCount) ||
        !(value.readAt === null || finite(value.readAt)) ||
        !(value.reason === null || typeof value.reason === 'string')) return null;
    hosts[id] = value as QuotaGuardHostView;
  }
  return {
    version: 1, enabled: data.enabled, revision: Number(data.revision),
    updatedAt: data.updatedAt, authoritativeHost: '6v', thresholdPercent: data.thresholdPercent,
    status: data.status as QuotaGuardSharedState['status'],
    triggerReason: data.triggerReason as string | null,
    sync: sync as QuotaGuardSharedState['sync'], hosts,
  };
}
