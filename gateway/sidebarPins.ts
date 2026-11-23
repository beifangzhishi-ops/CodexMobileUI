import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SidebarPin = { type: 'project' | 'thread'; hostId: '6v' | 'noha'; id: string };
export type SidebarPinSnapshot = { revision: number; items: SidebarPin[] };

function validPin(value: unknown): value is SidebarPin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pin = value as Record<string, unknown>;
  return Object.keys(pin).length === 3 &&
    (pin.type === 'project' || pin.type === 'thread') &&
    (pin.hostId === '6v' || pin.hostId === 'noha') &&
    typeof pin.id === 'string' && /^[\w-]{1,128}$/.test(pin.id);
}

function same(a: SidebarPin, b: SidebarPin): boolean {
  return a.type === b.type && a.hostId === b.hostId && a.id === b.id;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 6v-only shared state, read by both authenticated mobile RPC and tailnet Web UI. */
export class SidebarPinsStore {
  private readonly path: string;
  private readonly primaryMarker: string;

  constructor(stateDirectory: string) {
    this.path = join(stateDirectory, 'sidebar-pins.json');
    this.primaryMarker = join(stateDirectory, 'sidebar-pins-primary');
  }

  private requirePrimary(): void {
    if (!existsSync(this.primaryMarker)) throw new Error('PINS_PRIMARY_UNAVAILABLE');
  }

  async list(): Promise<SidebarPinSnapshot> {
    this.requirePrimary();
    let raw: string;
    try { raw = await readFile(this.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, items: [] };
      throw error;
    }
    if (raw.length > 64_000) throw new Error('PINS_STATE_INVALID');
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new Error('PINS_STATE_INVALID'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('PINS_STATE_INVALID');
    const record = data as Record<string, unknown>;
    if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0 ||
        !Array.isArray(record.items) || record.items.length > 300 || !record.items.every(validPin)) {
      throw new Error('PINS_STATE_INVALID');
    }
    return { revision: record.revision as number, items: record.items };
  }

  async set(pin: unknown, pinned: unknown): Promise<SidebarPinSnapshot> {
    this.requirePrimary();
    if (!validPin(pin) || typeof pinned !== 'boolean') throw new Error('PINS_INVALID_PARAMS');
    const lockPath = this.path + '.lock';
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let tries = 0; tries < 120; tries++) {
      try { handle = await open(lockPath, 'wx'); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          if (Date.now() - (await stat(lockPath)).mtimeMs > 30_000) await unlink(lockPath);
        } catch { /* Concurrent lock release; try again. */ }
        await pause(25);
      }
    }
    if (!handle) throw new Error('PINS_BUSY');
    try {
      const current = await this.list();
      const found = current.items.some((item) => same(item, pin));
      if (found === pinned) return current;
      const items = current.items.filter((item) => !same(item, pin));
      if (pinned) items.push(pin);
      if (items.length > 300) throw new Error('PINS_LIMIT');
      const snapshot = { revision: current.revision + 1, items };
      const tmp = this.path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(tmp, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
        await rename(tmp, this.path);
      } finally { await unlink(tmp).catch(() => undefined); }
      return snapshot;
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}
