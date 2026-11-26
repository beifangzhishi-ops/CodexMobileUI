import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CompletedThread = { hostId: '6v' | 'noha'; threadId: string };
export type ThreadCompletionsSnapshot = { revision: number; items: CompletedThread[] };

const MAX_ITEMS = 2000;

function validThread(value: unknown): value is CompletedThread {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const thread = value as Record<string, unknown>;
  return Object.keys(thread).length === 2 &&
    (thread.hostId === '6v' || thread.hostId === 'noha') &&
    typeof thread.threadId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(thread.threadId);
}

function same(a: CompletedThread, b: CompletedThread): boolean {
  return a.hostId === b.hostId && a.threadId === b.threadId;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Private 6v-only completion state shared by the tailnet Web UI. */
export class ThreadCompletionStore {
  private readonly path: string;
  private readonly primaryMarker: string;

  constructor(stateDirectory: string) {
    this.path = join(stateDirectory, 'thread-completions.json');
    // The Coordinator already requires this existing 6v-only marker for its
    // shared sidebar state. Reuse it rather than introducing another setup step.
    this.primaryMarker = join(stateDirectory, 'sidebar-pins-primary');
  }

  private requirePrimary(): void {
    if (!existsSync(this.primaryMarker)) throw new Error('COMPLETIONS_PRIMARY_UNAVAILABLE');
  }

  async list(): Promise<ThreadCompletionsSnapshot> {
    this.requirePrimary();
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, items: [] };
      throw error;
    }
    if (raw.length > 320_000) throw new Error('COMPLETIONS_STATE_INVALID');
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('COMPLETIONS_STATE_INVALID');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('COMPLETIONS_STATE_INVALID');
    }
    const record = data as Record<string, unknown>;
    if (Object.keys(record).length !== 2 ||
        !Number.isSafeInteger(record.revision) || (record.revision as number) < 0 ||
        !Array.isArray(record.items) || record.items.length > MAX_ITEMS ||
        !record.items.every(validThread)) {
      throw new Error('COMPLETIONS_STATE_INVALID');
    }
    const unique = new Set((record.items as CompletedThread[])
      .map((item) => item.hostId + ':' + item.threadId));
    if (unique.size !== record.items.length) throw new Error('COMPLETIONS_STATE_INVALID');
    return { revision: record.revision as number, items: record.items as CompletedThread[] };
  }

  async set(thread: unknown, completed: unknown): Promise<ThreadCompletionsSnapshot> {
    this.requirePrimary();
    if (!validThread(thread) || typeof completed !== 'boolean') {
      throw new Error('COMPLETIONS_INVALID_PARAMS');
    }
    const lockPath = this.path + '.lock';
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    for (let tries = 0; tries < 120; tries++) {
      try {
        handle = await open(lockPath, 'wx');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          if (Date.now() - (await stat(lockPath)).mtimeMs > 30_000) await unlink(lockPath);
        } catch { /* Concurrent lock release; try again. */ }
        await pause(25);
      }
    }
    if (!handle) throw new Error('COMPLETIONS_BUSY');
    try {
      const current = await this.list();
      const found = current.items.some((item) => same(item, thread));
      if (found === completed) return current;
      const items = current.items.filter((item) => !same(item, thread));
      if (completed) items.push(thread);
      if (items.length > MAX_ITEMS) throw new Error('COMPLETIONS_LIMIT');
      const snapshot = { revision: current.revision + 1, items };
      const tmp = this.path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(tmp, JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' });
        await rename(tmp, this.path);
      } finally {
        await unlink(tmp).catch(() => undefined);
      }
      return snapshot;
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}
