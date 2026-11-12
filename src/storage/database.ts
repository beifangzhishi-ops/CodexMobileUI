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
        CREATE TABLE IF NOT EXISTS pending_selections (
          host_id TEXT PRIMARY KEY, draft_id TEXT NOT NULL,
          project_id TEXT, cwd TEXT, uncertain INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS project_cache (
          host_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
          roots_json TEXT NOT NULL, position INTEGER,
          PRIMARY KEY (host_id, id)
        );
        CREATE TABLE IF NOT EXISTS thread_project_cache (
          host_id TEXT NOT NULL, thread_id TEXT NOT NULL, project_id TEXT,
          PRIMARY KEY (host_id, thread_id)
        );
        CREATE TABLE IF NOT EXISTS title_jobs (
          host_id TEXT NOT NULL, thread_id TEXT NOT NULL,
          cwd TEXT NOT NULL, first_message TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
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

export async function removeHost(hostId: string): Promise<void> {
  const db = await database();
  await db.runAsync('DELETE FROM hosts WHERE id=?', hostId);
}

export async function loadThreads(hostId: string): Promise<CodexThread[]> {
  const db = await database();
  const rows = await db.getAllAsync<{ id: string; title: string | null; cwd: string | null; updated_at: number }>(
    'SELECT id,title,cwd,updated_at FROM threads WHERE host_id=? ORDER BY updated_at DESC',
    hostId,
  );
  const projects = await db.getAllAsync<{ thread_id: string; project_id: string | null }>(
    'SELECT thread_id,project_id FROM thread_project_cache WHERE host_id=?', hostId,
  );
  const mapping = new Map(projects.map((r) => [r.thread_id, r.project_id]));
  return rows.map((r) => ({
    id: r.id, name: r.title, cwd: r.cwd, updatedAt: r.updated_at,
    projectId: mapping.get(r.id) ?? null,
  }));
}

export async function storeThreads(hostId: string, threads: readonly CodexThread[]): Promise<void> {
  const db = await database();
  for (const t of threads) {
    await db.runAsync(
      'INSERT INTO threads (host_id,id,title,cwd,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(host_id,id) DO UPDATE SET title=excluded.title,cwd=excluded.cwd,updated_at=excluded.updated_at',
      hostId, t.id, t.name, t.cwd, t.updatedAt,
    );
    await db.runAsync(
      'INSERT INTO thread_project_cache (host_id,thread_id,project_id) VALUES (?,?,?) ON CONFLICT(host_id,thread_id) DO UPDATE SET project_id=excluded.project_id',
      hostId, t.id, t.projectId ?? null,
    );
  }
}

export interface PendingSelectionRecord {
  id: string;
  projectId: string | null;
  cwd: string | null;
  creationUncertain?: boolean;
}

const queuePendingSelection = createKeyedWriteQueue();

export async function savePendingSelection(hostId: string, item: PendingSelectionRecord): Promise<void> {
  await queuePendingSelection(hostId, async () => {
    const db = await database();
    await db.runAsync(
      'INSERT INTO pending_selections (host_id,draft_id,project_id,cwd,uncertain) VALUES (?,?,?,?,?) ON CONFLICT(host_id) DO UPDATE SET draft_id=excluded.draft_id,project_id=excluded.project_id,cwd=excluded.cwd,uncertain=excluded.uncertain',
      hostId, item.id, item.projectId, item.cwd, item.creationUncertain ? 1 : 0,
    );
  });
}

export async function loadPendingSelection(hostId: string): Promise<PendingSelectionRecord | null> {
  const db = await database();
  const record = await db.getFirstAsync<{
    draft_id: string; project_id: string | null; cwd: string | null; uncertain: number;
  }>('SELECT draft_id,project_id,cwd,uncertain FROM pending_selections WHERE host_id=?', hostId);
  return record ? {
    id: record.draft_id, projectId: record.project_id, cwd: record.cwd,
    creationUncertain: record.uncertain === 1,
  } : null;
}

/** Persist the at-risk interval BEFORE sending thread/start, including across app restarts. */
export async function markPendingCreationAttempt(hostId: string, draftId: string): Promise<void> {
  await queuePendingSelection(hostId, async () => {
    const db = await database();
    await db.runAsync(
      'UPDATE pending_selections SET uncertain=1 WHERE host_id=? AND draft_id=?',
      hostId, draftId,
    );
  });
}

export async function clearPendingSelection(hostId: string, expectedId?: string): Promise<void> {
  await queuePendingSelection(hostId, async () => {
    const db = await database();
    if (expectedId) {
      await db.runAsync('DELETE FROM pending_selections WHERE host_id=? AND draft_id=?', hostId, expectedId);
    } else {
      await db.runAsync('DELETE FROM pending_selections WHERE host_id=?', hostId);
    }
  });
}

export async function storeProjects(
  hostId: string, projects: readonly { id: string; name: string; roots: string[]; position: number | null }[],
): Promise<void> {
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('DELETE FROM project_cache WHERE host_id=?', hostId);
    for (const project of projects) {
      await tx.runAsync(
        'INSERT INTO project_cache (host_id,id,name,roots_json,position) VALUES (?,?,?,?,?)',
        hostId, project.id, project.name, JSON.stringify(project.roots), project.position,
      );
    }
  });
}

export async function loadProjects(hostId: string): Promise<{
  id: string; name: string; roots: string[]; position: number | null;
}[]> {
  const db = await database();
  const rows = await db.getAllAsync<{
    id: string; name: string; roots_json: string; position: number | null;
  }>('SELECT id,name,roots_json,position FROM project_cache WHERE host_id=? ORDER BY position', hostId);
  return rows.map((row) => ({
    id: row.id, name: row.name, roots: JSON.parse(row.roots_json) as string[],
    position: row.position,
  }));
}

export interface TitleJob {
  threadId: string;
  cwd: string;
  firstMessage: string;
  attempts: number;
}

export async function enqueueTitleJob(
  hostId: string, threadId: string, cwd: string, firstMessage: string,
): Promise<void> {
  const db = await database();
  await db.runAsync(
    'INSERT OR IGNORE INTO title_jobs (host_id,thread_id,cwd,first_message) VALUES (?,?,?,?)',
    hostId, threadId, cwd, firstMessage.slice(0, 1500),
  );
}

export async function listTitleJobs(hostId: string): Promise<TitleJob[]> {
  const db = await database();
  const rows = await db.getAllAsync<{
    thread_id: string; cwd: string; first_message: string; attempts: number;
  }>('SELECT thread_id,cwd,first_message,attempts FROM title_jobs WHERE host_id=? AND attempts<2',
    hostId);
  return rows.map((r) => ({
    threadId: r.thread_id, cwd: r.cwd, firstMessage: r.first_message, attempts: r.attempts,
  }));
}

export async function claimTitleJob(hostId: string, threadId: string): Promise<boolean> {
  const db = await database();
  const result = await db.runAsync(
    'UPDATE title_jobs SET attempts=attempts+1 WHERE host_id=? AND thread_id=? AND attempts<2',
    hostId, threadId,
  );
  return result.changes === 1;
}

export async function removeTitleJob(hostId: string, threadId: string): Promise<void> {
  const db = await database();
  await db.runAsync('DELETE FROM title_jobs WHERE host_id=? AND thread_id=?', hostId, threadId);
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

export async function clearDraft(hostId: string, key: string): Promise<void> {
  await queueDraftWrite(JSON.stringify([hostId, key]), async () => {
    const db = await database();
    await db.runAsync('DELETE FROM drafts WHERE host_id=? AND thread_id=?', hostId, key);
  });
}
