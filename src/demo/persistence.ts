import * as SQLite from 'expo-sqlite';
import type { DemoState } from './conversations';

/** Visual-only database, isolated by both name and the visual Android package. */
const databasePromise = SQLite.openDatabaseAsync('codexmobile-visual-v1.db').then(async (database) => {
  await database.execAsync(
    'CREATE TABLE IF NOT EXISTS local_settings (name TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)',
  );
  return database;
});

export async function loadVisualState(): Promise<DemoState | null> {
  const database = await databasePromise;
  const row = await database.getFirstAsync<{ data: string }>(
    "SELECT data FROM local_settings WHERE name = 'visual_state'",
  );
  if (!row?.data) return null;
  try {
    const value = JSON.parse(row.data) as DemoState;
    return value && Array.isArray(value.conversations) &&
      Array.isArray(value.projects) && Array.isArray(value.hosts) ? value : null;
  } catch {
    return null;
  }
}

let queuedWrite: Promise<void> = Promise.resolve();

export function persistVisualState(state: DemoState): Promise<void> {
  const data = JSON.stringify(state);
  // Serialize writes so an older snapshot cannot overwrite a newer one.
  queuedWrite = queuedWrite.catch(() => undefined).then(async () => {
    const database = await databasePromise;
    await database.runAsync(
      "INSERT INTO local_settings (name,data) VALUES ('visual_state',?) " +
        'ON CONFLICT(name) DO UPDATE SET data = excluded.data',
      data,
    );
  });
  return queuedWrite;
}
