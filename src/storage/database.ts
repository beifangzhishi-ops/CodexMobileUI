import * as SQLite from 'expo-sqlite';
import type { ChatMessage, CodexThread } from '../core/protocol';
import type { Host } from '../core/host';
import { createKeyedWriteQueue } from './writeQueue';

let opening: Promise<SQLite.SQLiteDatabase> | undefined;

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = (async () => {
      const db = await SQLite.openDatabaseAsync('codexmobileui.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS hosts (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS threads (
          host_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT, cwd TEXT,
          updated_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (host_id, id)
        );
        CREATE TABLE IF NOT EXISTS messages (
          host_id TEXT NOT NULL, thread_id TEXT NOT NULL, id TEXT NOT NULL,
          turn_id TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL,
          ordinal INTEGER NOT NULL, PRIMARY KEY (host_id, thread_id, id)
        );
        CREATE INDEX IF NOT EXISTS messages_order
          ON messages (host_id, thread_id, ordinal);
        CREATE TABLE IF NOT EXISTS drafts (
          host_id TEXT NOT NULL, thread_id TEXT NOT NULL, text TEXT NOT NULL,
          PRIMARY KEY (host_id, thread_id)
        );
      `);
      return db;
    })().catch((error) => {
      opening = undefined;
      throw error;
    });
  }
  return opening;
}

export async function loadHosts(): Promise<Host[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ id: string; name: string; base_url: string }>(
    'SELECT id,name,base_url FROM hosts ORDER BY rowid',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, baseUrl: r.base_url }));
}

export async function storeHost(host: Host): Promise<void> {
  const db = await database();
  await db.runAsync(
    'INSERT INTO hosts (id,name,base_url) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url',
    host.id, host.name, host.baseUrl,
  );
}

export async function loadThreads(hostId: string): Promise<CodexThread[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ id: string; title: string | null; cwd: string | null; updated_at: number }>(
    'SELECT id,title,cwd,updated_at FROM threads WHERE host_id=? ORDER BY updated_at DESC',
    hostId,
  );
  return rows.map((r) => ({ id: r.id, name: r.title, cwd: r.cwd, updatedAt: r.updated_at }));
}

export async function storeThreads(hostId: string, threads: readonly CodexThread[]): Promise<void> {
  const db = await database();
  for (const t of threads) {
    await db.runAsync(
      'INSERT INTO threads (host_id,id,title,cwd,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(host_id,id) DO UPDATE SET title=excluded.title,cwd=excluded.cwd,updated_at=excluded.updated_at',
      hostId, t.id, t.name, t.cwd, t.updatedAt,
    );
  }
}

export async function loadMessages(hostId: string, threadId: string): Promise<ChatMessage[]> {
  const db = await database();
  const rows = await db.getAllAsync<{
    id: string; turn_id: string; role: 'user' | 'assistant'; body: string; ordinal: number;
  }>(
    'SELECT id,turn_id,role,body,ordinal FROM messages WHERE host_id=? AND thread_id=? ORDER BY ordinal',
    hostId, threadId,
  );
  return rows.map((r) => ({
    id: r.id, threadId, turnId: r.turn_id, role: r.role, text: r.body,
    ordinal: r.ordinal, complete: true,
  }));
}

/**
 * Replaces an authoritative snapshot. Stream deltas should never be treated
 * as a second history source, and a stale cache must not overwrite newer data.
 */
export async function replaceMessages(
  hostId: string, threadId: string, messages: readonly ChatMessage[],
): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM messages WHERE host_id=? AND thread_id=?', hostId, threadId);
    for (const m of messages) {
      await tx.runAsync(
        'INSERT INTO messages (host_id,thread_id,id,turn_id,role,body,ordinal) VALUES (?,?,?,?,?,?,?)',
        hostId, threadId, m.id, m.turnId, m.role, m.text, m.ordinal,
      );
    }
  });
}

export async function loadDraft(hostId: string, threadId: string): Promise<string> {
  const db = await database();
  const row = await db.getFirstAsync<{ text: string }>(
    'SELECT text FROM drafts WHERE host_id=? AND thread_id=?', hostId, threadId,
  );
  return row?.text ?? '';
}

// Preserve typing order even when SQLite's asynchronous writes finish out of order.
// A later empty draft after a successful send must not be overwritten by an older
// in-flight keystroke write.
const queueDraftWrite = createKeyedWriteQueue();

export async function storeDraft(hostId: string, threadId: string, text: string): Promise<void> {
  const key = JSON.stringify([hostId, threadId]);
  await queueDraftWrite(key, async () => {
    const db = await database();
    await db.runAsync(
      'INSERT INTO drafts (host_id,thread_id,text) VALUES (?,?,?) ON CONFLICT(host_id,thread_id) DO UPDATE SET text=excluded.text',
      hostId, threadId, text,
    );
  });
}
