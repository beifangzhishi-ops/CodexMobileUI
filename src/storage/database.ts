import * as SQLite from 'expo-sqlite';
import { unifiedWebUrl } from '../core/unifiedWeb';

/**
 * Android only remembers its private HTTPS coordinator.
 * Threads, drafts, models, permissions and messages belong to the shared Web UI
 * and independent host App Servers. Do not drop older SQLite tables on upgrade:
 * this migration intentionally leaves historical user data intact. The legacy
 * hosts table is retained but is not read or updated by the HTTPS-only client.
 */
let opening: Promise<SQLite.SQLiteDatabase> | undefined;

async function database(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) {
    opening = (async () => {
      const db = await SQLite.openDatabaseAsync('codexmobileui.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS hosts (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS mobile_network (
          id INTEGER PRIMARY KEY CHECK(id=1), coordinator TEXT NOT NULL
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

export async function loadCoordinatorUrl(): Promise<string | null> {
  const db = await database();
  const row = await db.getFirstAsync<{ coordinator: string }>(
    'SELECT coordinator FROM mobile_network WHERE id=1');
  return row?.coordinator ?? null;
}

export async function storeCoordinatorUrl(coordinator: string): Promise<void> {
  if (unifiedWebUrl(coordinator) !== coordinator) {
    throw new Error('INVALID_HTTPS_COORDINATOR');
  }
  const db = await database();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'INSERT INTO mobile_network(id,coordinator) VALUES(1,?) ' +
      'ON CONFLICT(id) DO UPDATE SET coordinator=excluded.coordinator',
      coordinator,
    );
  });
}
