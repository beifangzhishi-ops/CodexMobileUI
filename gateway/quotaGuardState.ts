import { randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  QuotaGuardRuntime, QuotaGuardSetting, QuotaHostId,
} from '../shared/quotaGuard.js';
import { parseQuotaGuardRuntime } from '../shared/quotaGuard.js';

type StoredSetting = {
  version: 1;
  enabled: boolean;
  revision: number;
  updatedAt: number;
  syncedAt: number | null;
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
  const syncedAt = data.syncedAt as number | null;
  const pending = expectedHost === 'noha' &&
    (syncedAt === null || syncedAt > now + 30_000 || now - syncedAt > maxSyncAgeMs);
  return {
    enabled: data.enabled, revision: Number(data.revision), updatedAt: data.updatedAt,
    syncedAt, pending,
    reason: pending ? '等待 6v 同步共享保护设置' : null,
  };
}

export class QuotaGuardSettingStore {
  readonly settingFile: string;
  readonly runtimeFile: string;

  constructor(private readonly stateDirectory: string,
    private readonly maxSyncAgeMs = 30_000) {
    this.settingFile = join(stateDirectory, 'quota-guard-setting.json');
    this.runtimeFile = join(stateDirectory, 'quota-guard-runtime.json');
  }

  readAuthoritativeSync(now = Date.now()): QuotaGuardSetting {
    if (!existsSync(this.settingFile)) {
      return { enabled: false, revision: 0, updatedAt: 0,
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
      return { enabled: false, revision: 0, updatedAt: 0, syncedAt: null,
        pending: true, reason: '等待 6v 同步共享保护设置' };
    }
    try {
      return parseStoredSetting(readFileSync(this.settingFile, 'utf8'), 'noha',
        this.maxSyncAgeMs, now);
    } catch {
      return { enabled: false, revision: 0, updatedAt: 0, syncedAt: null,
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

  async setEnabled(enabled: unknown, expectedRevision: unknown,
    now = Date.now()): Promise<QuotaGuardSetting> {
    if (typeof enabled !== 'boolean' || !Number.isSafeInteger(expectedRevision) ||
        Number(expectedRevision) < 0) throw new Error('QUOTA_GUARD_INVALID_PARAMS');
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
      if (current.enabled === enabled) return current;
      const next: StoredSetting = {
        version: 1, enabled, revision: current.revision + 1, updatedAt: now,
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
    now = Date.now()): QuotaGuardSetting {
    if (!Number.isSafeInteger(revision) || revision < 0 ||
        !Number.isFinite(updatedAt) || updatedAt < 0) throw new Error('QUOTA_GUARD_SYNC_INVALID');
    const previous = this.readMirrorSync(now);
    if (revision < previous.revision) return previous;
    mkdirSync(dirname(this.settingFile), { recursive: true });
    const value: StoredSetting = {
      version: 1, enabled, revision, updatedAt, syncedAt: now,
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
    'QUOTA_GUARD_MONITOR_UNAVAILABLE' | 'QUOTA_GUARD_STATE_INVALID' | null;
};

export interface QuotaGuardGate {
  admission(now?: number): QuotaGuardAdmission;
}

export function quotaGuardFileAdmission(store: QuotaGuardSettingStore,
  hostId: QuotaHostId, maxReadAgeMs: number, now = Date.now()): QuotaGuardAdmission {
  let setting: QuotaGuardSetting;
  try { setting = store.readSettingSync(hostId, now); }
  catch { return { allowed: false, reason: 'QUOTA_GUARD_STATE_INVALID' }; }
  if (setting.pending) return { allowed: false, reason: 'QUOTA_GUARD_SYNC_PENDING' };
  if (!setting.enabled) return { allowed: true, reason: null };
  const runtime = store.readRuntimeSync(hostId);
  if (runtime?.triggers.length) return { allowed: false, reason: 'QUOTA_GUARD_BLOCKED' };
  if (!runtime || runtime.nativeStatus !== 'online' ||
      runtime.lastReadAt === null || now - runtime.lastReadAt > maxReadAgeMs) {
    return { allowed: false, reason: 'QUOTA_GUARD_MONITOR_UNAVAILABLE' };
  }
  return { allowed: true, reason: null };
}
