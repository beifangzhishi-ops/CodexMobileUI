import * as SQLite from 'expo-sqlite';

export type UiPreferences = {
  pinnedThreads: string[];
  pinnedProjects: string[];
  lastRead: Record<string, number>;
  projectRules: Record<string, string>;
  globalRules: string;
  includeProjectConversations: boolean;
};

export const defaultUiPreferences = (): UiPreferences => ({
  pinnedThreads: [],
  pinnedProjects: [],
  lastRead: {},
  projectRules: {},
  globalRules: '',
  includeProjectConversations: true,
});

let opening: Promise<SQLite.SQLiteDatabase> | undefined;
function database() {
  if (!opening) {
    opening = SQLite.openDatabaseAsync('codexmobileui-ui-settings.db').then(async (db) => {
      await db.execAsync('CREATE TABLE IF NOT EXISTS preferences (host_id TEXT PRIMARY KEY, data TEXT NOT NULL)');
      return db;
    }).catch((error: unknown) => { opening = undefined; throw error; });
  }
  return opening;
}

export async function loadUiPreferences(hostId: string): Promise<UiPreferences> {
  const db = await database();
  const row = await db.getFirstAsync<{ data: string }>(
    'SELECT data FROM preferences WHERE host_id=?', hostId);
  if (!row) return defaultUiPreferences();
  try {
    const value: unknown = JSON.parse(row.data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultUiPreferences();
    const raw = value as Record<string, unknown>;
    return {
      pinnedThreads: Array.isArray(raw.pinnedThreads) ? raw.pinnedThreads.filter((v): v is string => typeof v === 'string') : [],
      pinnedProjects: Array.isArray(raw.pinnedProjects) ? raw.pinnedProjects.filter((v): v is string => typeof v === 'string') : [],
      lastRead: raw.lastRead && typeof raw.lastRead === 'object' && !Array.isArray(raw.lastRead)
        ? raw.lastRead as Record<string, number> : {},
      projectRules: raw.projectRules && typeof raw.projectRules === 'object' && !Array.isArray(raw.projectRules)
        ? raw.projectRules as Record<string, string> : {},
      globalRules: typeof raw.globalRules === 'string' ? raw.globalRules : '',
      includeProjectConversations: typeof raw.includeProjectConversations === 'boolean'
        ? raw.includeProjectConversations : true,
    };
  } catch {
    return defaultUiPreferences();
  }
}

let queued: Promise<void> = Promise.resolve();
export async function persistUiPreferences(hostId: string, settings: UiPreferences): Promise<void> {
  const data = JSON.stringify(settings);
  queued = queued.catch(() => undefined).then(async () => {
    const db = await database();
    await db.runAsync(
      'INSERT INTO preferences (host_id,data) VALUES (?,?) ON CONFLICT(host_id) DO UPDATE SET data=excluded.data',
      hostId, data);
  });
  return queued;
}
