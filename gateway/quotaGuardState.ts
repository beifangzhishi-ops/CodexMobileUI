import { randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  QuotaGuardRuntime, QuotaGuardSetting, QuotaHostId,
} from '../shared/quotaGuard.js';
import { isQuotaGuardThreshold, parseQuotaGuardRuntime, QUOTA_GUARD_THRESHOLD_PERCENT } from '../shared/quotaGuard.js';

type StoredSetting = {
  version: 1;
  enabled: boolean;
  thresholdPercent: number;
  revision: number;
  updatedAt: number;
  syncedAt: number | null;
};
type StoredPeerRuntime = {
  version: 1;
  receivedAt: number;
  runtime: QuotaGuardRuntime;
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseStoredSetting(raw: string, expectedHost: QuotaHostId,
  maxSyncAgeMs: number, now: number): QuotaGuardSetting {
  const data = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<StoredSetting>;
  if (data.version !== 1 || typeof data.enabled !== 'boolean' ||
      !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 ||
      typeof data.updatedAt !== 'number' || !Number.isFinite(data.updatedAt) ||
      !(data.syncedAt === null || typeof data.syncedAt === 'number' &&
        Number.isFinite(data.syncedAt))) throw new Error('QUOTA_GUARD_STATE_INVALID');
  const thresholdPercent = data.thresholdPercent === undefined
    ? QUOTA_GUARD_THRESHOLD_PERCENT : data.thresholdPercent;
  if (!isQuotaGuardThreshold(thresholdPercent)) throw new Error('QUOTA_GUARD_STATE_INVALID');
  const syncedAt = data.syncedAt as number | null;
  const pending = expectedHost === 'noha' &&
    (syncedAt === null || syncedAt > now + 30_000 || now - syncedAt > maxSyncAgeMs);
  return {
    enabled: data.enabled, thresholdPercent, revision: Number(data.revision), updatedAt: data.updatedAt,
    syncedAt, pending,
    reason: pending ? '等待 6v 同步共享保护设置' : null,
  };
}

export class QuotaGuardSettingStore {
  readonly settingFile: string;
  readonly runtimeFile: string;
  readonly peerRuntimeFile: string;

  constructor(private readonly stateDirectory: string,
    private readonly maxSyncAgeMs = 30_000) {
    this.settingFile = join(stateDirectory, 'quota-guard-setting.json');
    this.runtimeFile = join(stateDirectory, 'quota-guard-runtime.json');
    this.peerRuntimeFile = join(stateDirectory, 'quota-guard-peer-runtime.json');
  }

  readAuthoritativeSync(now = Date.now()): QuotaGuardSetting {
    if (!existsSync(this.settingFile)) {
      return { enabled: false, thresholdPercent: QUOTA_GUARD_THRESHOLD_PERCENT, revision: 0, updatedAt: 0,
        syncedAt: now, pending: false, reason: null };
    }
    try {
      return parseStoredSetting(readFileSync(this.settingFile, 'utf8'), '6v',
        this.maxSyncAgeMs, now);
    } catch {
      throw new Error('QUOTA_GUARD_STATE_INVALID');
    }
  }

  readMirrorSync(now = Date.now()): QuotaGuardSetting {
    if (!existsSync(this.settingFile)) {
      return { enabled: false, thresholdPercent: QUOTA_GUARD_THRESHOLD_PERCENT, revision: 0, updatedAt: 0, syncedAt: null,
        pending: true, reason: '等待 6v 同步共享保护设置' };
    }
    try {
      return parseStoredSetting(readFileSync(this.settingFile, 'utf8'), 'noha',
        this.maxSyncAgeMs, now);
    } catch {
      return { enabled: false, thresholdPercent: QUOTA_GUARD_THRESHOLD_PERCENT, revision: 0, updatedAt: 0, syncedAt: null,
        pending: true, reason: '共享保护设置无法校验，等待 6v 重新同步' };
    }
  }

  readSettingSync(hostId: QuotaHostId, now = Date.now()): QuotaGuardSetting {
    return hostId === 'noha' ? this.readMirrorSync(now) : this.readAuthoritativeSync(now);
  }

  readRuntimeSync(hostId: QuotaHostId): QuotaGuardRuntime | null {
    try {
      return parseQuotaGuardRuntime(JSON.parse(readFileSync(this.runtimeFile, 'utf8')), hostId);
    } catch {
      return null;
    }
  }

  readPeerRuntimeSync(expectedHost: QuotaHostId): StoredPeerRuntime | null {
    try {
      const parsed = JSON.parse(readFileSync(this.peerRuntimeFile, 'utf8')) as Partial<StoredPeerRuntime>;
      if (parsed.version !== 1 || typeof parsed.receivedAt !== 'number' ||
          !Number.isFinite(parsed.receivedAt)) return null;
      const runtime = parseQuotaGuardRuntime(parsed.runtime, expectedHost);
      return runtime ? { version: 1, receivedAt: parsed.receivedAt, runtime } : null;
    } catch {
      return null;
    }
  }

  async setEnabled(enabled: unknown, expectedRevision: unknown,
    now = Date.now(), thresholdPercent?: unknown): Promise<QuotaGuardSetting> {
    if (typeof enabled !== 'boolean' || !Number.isSafeInteger(expectedRevision) ||
        Number(expectedRevision) < 0 ||
        (thresholdPercent !== undefined && !isQuotaGuardThreshold(thresholdPercent))) throw new Error('QUOTA_GUARD_INVALID_PARAMS');
    mkdirSync(this.stateDirectory, { recursive: true });
    const lockPath = this.settingFile + '.lock';
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let tries = 0; tries < 120; tries++) {
      try {
        handle = await open(lockPath, 'wx');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          if (now - (await stat(lockPath)).mtimeMs > 30_000) await unlink(lockPath);
        } catch { /* Another request released the stale lock. */ }
        await pause(25);
      }
    }
    if (!handle) throw new Error('QUOTA_GUARD_BUSY');
    try {
      const current = this.readAuthoritativeSync(now);
      if (current.revision !== Number(expectedRevision)) throw new Error('QUOTA_GUARD_CONFLICT');
      const nextThreshold = thresholdPercent === undefined ? current.thresholdPercent : thresholdPercent;
      if (current.enabled === enabled && current.thresholdPercent === nextThreshold) return current;
      const next: StoredSetting = {
        version: 1, enabled, thresholdPercent: nextThreshold, revision: current.revision + 1, updatedAt: now,
        syncedAt: now,
      };
      const temporary = this.settingFile + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, this.settingFile);
      } finally { await unlink(temporary).catch(() => undefined); }
      return this.readAuthoritativeSync(now);
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  writeMirrorSync(enabled: boolean, revision: number, updatedAt: number,
    now = Date.now(), thresholdPercent = QUOTA_GUARD_THRESHOLD_PERCENT): QuotaGuardSetting {
    if (!isQuotaGuardThreshold(thresholdPercent) || !Number.isSafeInteger(revision) || revision < 0 ||
        !Number.isFinite(updatedAt) || updatedAt < 0) throw new Error('QUOTA_GUARD_SYNC_INVALID');
    const previous = this.readMirrorSync(now);
    if (revision < previous.revision) return previous;
    mkdirSync(dirname(this.settingFile), { recursive: true });
    const value: StoredSetting = {
      version: 1, enabled, thresholdPercent, revision, updatedAt, syncedAt: now,
    };
    const temporary = this.settingFile + '.' + process.pid + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, this.settingFile);
    } finally {
      try { unlinkSync(temporary); } catch { /* Already renamed. */ }
    }
    return this.readMirrorSync(now);
  }

  writeRuntimeSync(runtime: QuotaGuardRuntime): void {
    mkdirSync(dirname(this.runtimeFile), { recursive: true });
    const temporary = this.runtimeFile + '.' + process.pid + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(runtime), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, this.runtimeFile);
    } finally {
      try { unlinkSync(temporary); } catch { /* Already renamed. */ }
    }
  }

  writePeerRuntimeSync(runtime: unknown, expectedHost: QuotaHostId,
    receivedAt = Date.now()): StoredPeerRuntime {
    const parsed = parseQuotaGuardRuntime(runtime, expectedHost);
    if (!parsed) throw new Error('QUOTA_GUARD_PEER_STATE_INVALID');
    const previous = this.readPeerRuntimeSync(expectedHost);
    if (previous && parsed.revision < previous.runtime.revision) return previous;
    if (previous && parsed.revision === previous.runtime.revision) {
      if (parsed.updatedAt < previous.runtime.updatedAt) return previous;
      const previousLow = previous.runtime.triggers.length > 0;
      if (previousLow && parsed.triggers.length === 0) return previous;
    }
    if (previous?.runtime.triggers.length && parsed.triggers.length === 0) {
      const lastLowSeenAt = Math.max(...previous.runtime.triggers.map((item) => item.lastSeenAt));
      if (parsed.nativeStatus !== 'online' || parsed.lastReadAt === null ||
          parsed.lastReadAt < lastLowSeenAt) return previous;
    }
    const value: StoredPeerRuntime = { version: 1, receivedAt, runtime: parsed };
    mkdirSync(dirname(this.peerRuntimeFile), { recursive: true });
    const temporary = this.peerRuntimeFile + '.' + process.pid + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, this.peerRuntimeFile);
    } finally {
      try { unlinkSync(temporary); } catch { /* Already renamed. */ }
    }
    return value;
  }

  async readRuntime(): Promise<QuotaGuardRuntime | null> {
    try {
      return parseQuotaGuardRuntime(JSON.parse(await readFile(this.runtimeFile, 'utf8')));
    } catch {
      return null;
    }
  }
}

export type QuotaGuardAdmission = {
  allowed: boolean;
  reason: 'QUOTA_GUARD_BLOCKED' | 'QUOTA_GUARD_SYNC_PENDING' |
    'QUOTA_GUARD_MONITOR_UNAVAILABLE' | 'QUOTA_GUARD_STATE_INVALID' |
    'QUOTA_GUARD_PEER_BLOCKED' | 'QUOTA_GUARD_PEER_PENDING' | null;
};

export interface QuotaGuardGate {
  admission(now?: number): QuotaGuardAdmission;
}

export function quotaGuardFileAdmission(store: QuotaGuardSettingStore,
  hostId: QuotaHostId, maxReadAgeMs: number, now = Date.now(),
  maxPeerAgeMs = 30_000): QuotaGuardAdmission {
  let setting: QuotaGuardSetting;
  try { setting = store.readSettingSync(hostId, now); }
  catch { return { allowed: false, reason: 'QUOTA_GUARD_STATE_INVALID' }; }
  if (setting.pending) return { allowed: false, reason: 'QUOTA_GUARD_SYNC_PENDING' };
  if (!setting.enabled) return { allowed: true, reason: null };
  const runtime = store.readRuntimeSync(hostId);
  if (runtime?.settingRevision === setting.revision && runtime.triggers.length) return { allowed: false, reason: 'QUOTA_GUARD_BLOCKED' };
  const peerHost: QuotaHostId = hostId === '6v' ? 'noha' : '6v';
  const peer = store.readPeerRuntimeSync(peerHost);
  if (peer?.runtime.settingRevision === setting.revision && peer.runtime.triggers.length) return { allowed: false, reason: 'QUOTA_GUARD_PEER_BLOCKED' };
  if (!runtime || runtime.settingRevision !== setting.revision || runtime.nativeStatus !== 'online' ||
      runtime.lastReadAt === null || now - runtime.lastReadAt > maxReadAgeMs) {
    return { allowed: false, reason: 'QUOTA_GUARD_MONITOR_UNAVAILABLE' };
  }
  if (!peer || peer.runtime.settingRevision !== setting.revision || peer.runtime.nativeStatus !== 'online' ||
      peer.runtime.lastReadAt === null || now - peer.receivedAt > maxPeerAgeMs ||
      now - peer.runtime.lastReadAt > maxReadAgeMs) {
    return { allowed: false, reason: 'QUOTA_GUARD_PEER_PENDING' };
  }
  return { allowed: true, reason: null };
}
