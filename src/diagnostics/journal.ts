import * as SQLite from 'expo-sqlite';
import { sanitizeDiagnosticEvent, type DiagnosticEvent } from './safe';

const DB_NAME = 'codexmobileui-diagnostics.db';
const MAX_STORED_EVENTS = 1800;
const MAX_AGE_DAYS = 7;
const session = 's' + Math.floor(Date.now() / 1000).toString(36);
let sequence = 0;
let opening: Promise<SQLite.SQLiteDatabase> | undefined;
let pending: Promise<void> = Promise.resolve();
let storageFailed = false;
const fallback: DiagnosticEvent[] = [];

async function openJournal(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync([
        'PRAGMA journal_mode = WAL;',
        'CREATE TABLE IF NOT EXISTS diagnostic_events (',
        'id INTEGER PRIMARY KEY AUTOINCREMENT,',
        'recorded_at INTEGER NOT NULL, timestamp TEXT NOT NULL,',
        'session TEXT NOT NULL, sequence INTEGER NOT NULL,',
        'event TEXT NOT NULL, fields_json TEXT NOT NULL);',
        'CREATE INDEX IF NOT EXISTS diagnostic_events_time ON diagnostic_events(recorded_at);',
      ].join(' '));
      return db;
    })().catch((error: unknown) => {
      opening = undefined;
      throw error;
    });
  }
  return opening;
}

/** Fire-and-forget; never block a tap or network request. */
export function logDiagnostic(event: string, fields: Record<string, unknown> = {}): void {
  const safe = sanitizeDiagnosticEvent(event, fields);
  const entry: DiagnosticEvent = {
    timestamp: new Date().toISOString(),
    session,
    sequence: ++sequence,
    event: safe.event,
    fields: safe.fields,
  };
  fallback.push(entry);
  if (fallback.length > 300) fallback.shift();

  pending = pending.then(async () => {
    const db = await openJournal();
    await db.runAsync(
      'INSERT INTO diagnostic_events (recorded_at,timestamp,session,sequence,event,fields_json) VALUES (?,?,?,?,?,?)',
      Date.now(), entry.timestamp, entry.session, entry.sequence, entry.event,
      JSON.stringify(entry.fields),
    );
    if (entry.sequence % 25 === 0) {
      const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
      await db.runAsync('DELETE FROM diagnostic_events WHERE recorded_at < ?', cutoff);
      await db.execAsync(
        'DELETE FROM diagnostic_events WHERE id NOT IN (SELECT id FROM diagnostic_events ORDER BY id DESC LIMIT 1800)',
      );
    }
  }).catch(() => {
    // Logging must never break app functionality or recursively log itself.
    storageFailed = true;
  });
}

export async function readDiagnostics(): Promise<{
  events: DiagnosticEvent[];
  durableStorageAvailable: boolean;
}> {
  await pending;
  try {
    const db = await openJournal();
    const rows = await db.getAllAsync<{
      timestamp: string; session: string; sequence: number;
      event: string; fields_json: string;
    }>(
      'SELECT timestamp,session,sequence,event,fields_json FROM diagnostic_events ' +
      'WHERE recorded_at >= ? ORDER BY id DESC LIMIT ?',
      Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
      MAX_STORED_EVENTS,
    );
    return {
      events: rows.reverse().map((row) => ({
        timestamp: row.timestamp,
        session: row.session,
        sequence: row.sequence,
        ...sanitizeDiagnosticEvent(row.event, JSON.parse(row.fields_json) as Record<string, unknown>),
      })),
      durableStorageAvailable: !storageFailed,
    };
  } catch {
    return { events: [...fallback], durableStorageAvailable: false };
  }
}

export async function clearDiagnostics(): Promise<void> {
  await pending;
  const db = await openJournal();
  await db.execAsync('DELETE FROM diagnostic_events');
  fallback.length = 0;
  storageFailed = false;
  logDiagnostic('diagnostics.cleared');
}
