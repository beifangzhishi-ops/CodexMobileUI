/**
 * Local presentation state for the one shared browser / Android WebView UI.
 * Canonical projects, threads and shared pins remain owned by the servers.
 */
import type { HostId } from './types';

export type SidebarPreferences = {
  showAllRecent: boolean;
  collapsedHosts: HostId[];
  openedProjects: string[];
  collapsedSections: string[];
  sidebarOpen: boolean | null;
};

const key = 'codex-web-sidebar-preferences-v1';
const legacySectionsKey = 'codex-web-collapsed-sections';
const validSections = new Set(['pinned', 'projects', 'recent']);

export function defaultSidebarPreferences(): SidebarPreferences {
  return {
    showAllRecent: true,
    collapsedHosts: [],
    openedProjects: [],
    collapsedSections: [],
    // Preserve the responsive first-visit defaults: open on desktop,
    // closed on small screens. After user interaction this is a boolean.
    sidebarOpen: null,
  };
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 300).filter((item): item is string =>
    typeof item === 'string' && item.length > 0 && item.length <= 200))];
}

export function parseSidebarPreferences(value: unknown, legacySections?: unknown): SidebarPreferences {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const sections = 'collapsedSections' in raw ? raw.collapsedSections : legacySections;
  return {
    showAllRecent: typeof raw.showAllRecent === 'boolean' ? raw.showAllRecent : true,
    collapsedHosts: ids(raw.collapsedHosts).filter((host): host is HostId =>
      host === '6v' || host === 'noha'),
    openedProjects: ids(raw.openedProjects),
    collapsedSections: ids(sections).filter((section) => validSections.has(section)),
    sidebarOpen: typeof raw.sidebarOpen === 'boolean' ? raw.sidebarOpen : null,
  };
}

export function loadSidebarPreferences(storage: Pick<Storage, 'getItem'>): SidebarPreferences {
  try {
    const stored = storage.getItem(key);
    const old = storage.getItem(legacySectionsKey);
    return parseSidebarPreferences(
      stored === null ? null : JSON.parse(stored),
      old === null ? null : (() => { try { return JSON.parse(old); } catch { return null; } })(),
    );
  } catch {
    // Corrupt or unavailable storage must not prevent the shared UI loading.
    return defaultSidebarPreferences();
  }
}

export function saveSidebarPreferences(
  storage: Pick<Storage, 'setItem'>, preferences: SidebarPreferences,
): void {
  try {
    storage.setItem(key, JSON.stringify(preferences));
  } catch {
    // Private browsing / constrained WebViews may disable persistence.
  }
}
