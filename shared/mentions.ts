/** Codex native Skill/App/Plugin mentions. No filesystem references or uploads. */
import { safeToolLogoUrl } from './toolVisuals.ts';

export type Mention = {
  kind: 'skill' | 'app' | 'plugin';
  name: string;
  label: string;
  path: string;
  description: string;
  pluginId?: string;
  iconUrl?: string;
  skillCount?: number;
};

export type NativeMention = { type: 'skill' | 'mention'; name: string; path: string };
type Rpc = (method: string, params: Record<string, unknown>) => Promise<unknown>;
const row = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const str = (x: unknown): string => typeof x === 'string' ? x : '';
const array = (x: unknown): unknown[] => Array.isArray(x) ? x : [];
const distinct = (items: Mention[]) => [...new Map(items.map((item) =>
  [item.kind + ':' + item.path, item])).values()];
const icon = (...candidates: unknown[]) => {
  for (const value of candidates) {
    const url = safeToolLogoUrl(value);
    if (url) return url;
  }
  return undefined;
};
const CATALOG_KEY = 'codex-web-mentions-v2';
const MAX_SCOPES = 12;
type Catalog = { scope: string; items: Mention[]; updatedAt: number };
const catalogs = new Map<string, Catalog>();
const pending = new Map<string, { promise: Promise<Mention[]>;
  listeners: Set<(items: Mention[]) => void> }>();
let loaded = false;

function loadCatalogs() {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof localStorage === 'undefined') return;
    const entries = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? '[]');
    if (!Array.isArray(entries)) return;
    for (const entry of entries.slice(0, MAX_SCOPES)) {
      if (typeof entry?.scope === 'string' && Array.isArray(entry.items) &&
          typeof entry.updatedAt === 'number' && entry.updatedAt <= Date.now()) {
        catalogs.set(entry.scope, entry);
      }
    }
  } catch { /* Storage can be disabled in private WebViews. In-memory cache still works. */ }
}

export function cachedMentions(scope: string): Mention[] {
  loadCatalogs();
  return catalogs.get(scope)?.items ?? [];
}

function saveCatalog(scope: string, items: Mention[], complete: boolean) {
  loadCatalogs();
  const previous = catalogs.get(scope);
  catalogs.delete(scope);
  catalogs.set(scope, { scope, items: distinct(items).slice(0, 500),
    updatedAt: complete ? Date.now() : previous?.updatedAt ?? 0 });
  while (catalogs.size > MAX_SCOPES) catalogs.delete(catalogs.keys().next().value!);
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(CATALOG_KEY, JSON.stringify([...catalogs.values()]));
  } catch { /* Keep the in-memory result if storage is full. */ }
}

/** Cache immediately, share one in-flight refresh per host/project and publish partial catalogs. */
export function refreshCachedMentions(scope: string, request: Rpc,
  cwd?: string | null, threadId?: string | null,
  notify?: (items: Mention[]) => void): Promise<Mention[]> {
  loadCatalogs();
  const existing = pending.get(scope);
  if (existing) {
    if (notify) existing.listeners.add(notify);
    return existing.promise;
  }
  const listeners = new Set<(items: Mention[]) => void>();
  if (notify) listeners.add(notify);
  const publish = (items: Mention[], complete: boolean) => {
    saveCatalog(scope, items, complete);
    for (const listener of listeners) listener(items);
  };
  const promise = fetchMentions(request, cwd, threadId, cachedMentions(scope),
    (items) => publish(items, false)).then((items) => {
      publish(items, true);
      return items;
    }).catch(() => cachedMentions(scope)).finally(() => { pending.delete(scope); });
  pending.set(scope, { promise, listeners });
  return promise;
}

function deadline<T>(task: Promise<T>, milliseconds = 6500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MENTION_CATALOG_TIMEOUT')), milliseconds);
    task.then((value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Each category can fail independently (old Codex servers need not support all of them). */
export async function fetchMentions(request: Rpc, cwd?: string | null, threadId?: string | null,
  cached: readonly Mention[] = [], onUpdate?: (items: Mention[]) => void): Promise<Mention[]> {
  const apps = async () => {
    const data: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const response = row(await deadline(request('app/list', {
        limit: 100, ...(threadId ? { threadId } : {}),
        forceRefetch: false, ...(cursor ? { cursor } : {}),
      })));
      data.push(...array(response.data));
      const next = str(response.nextCursor);
      if (!next || next === cursor) break;
      cursor = next;
    }
    return { data };
  };
  const plugins = async () => {
    try {
      return await deadline(request('plugin/installed', cwd ? { cwds: [cwd] } : {}));
    } catch {
      return deadline(request('plugin/list', cwd ? { cwds: [cwd], forceRefetch: false } : { forceRefetch: false }));
    }
  };
  const collected: Record<Mention['kind'], Mention[]> = {
    skill: cached.filter((entry) => entry.kind === 'skill'),
    app: cached.filter((entry) => entry.kind === 'app'),
    plugin: cached.filter((entry) => entry.kind === 'plugin'),
  };
  let successful = 0;
  const snapshot = () => distinct([...collected.skill, ...collected.app, ...collected.plugin]);
  const collectSkills = (value: unknown): Mention[] => {
    const result: Mention[] = [];
    for (const group of array(row(value).data)) {
      for (const skill of array(row(group).skills)) {
        const s = row(skill), name = str(s.name), path = str(s.path);
        if (!name || !path || s.enabled === false) continue;
        const info = row(s.interface);
        result.push({ kind: 'skill', name, label: str(info.displayName) || name,
          path, description: str(info.shortDescription) || str(s.description),
          pluginId: str(s.pluginId) || undefined,
          iconUrl: icon(info.icon, info.iconUrl, info.logoUrl) });
      }
    }
    return result;
  };
  const collectApps = (value: unknown): Mention[] => {
    const result: Mention[] = [];
    for (const app of array(row(value).data)) {
      const a = row(app), id = str(a.id), name = str(a.name) || id;
      if (id && a.isAccessible === true && a.isEnabled === true) {
        result.push({ kind: 'app', name, label: name, path: 'app://' + id,
          description: str(a.description), iconUrl: icon(a.logoUrl, a.iconUrl, a.logo,
            a.icon, row(a.icons).small, row(a.logoUrls).small,
            row(a.branding).logo, row(a.interface).icon, a.imageUrl) });
      }
    }
    return result;
  };
  const collectPlugins = (value: unknown): Mention[] => {
    const result: Mention[] = [];
    // App-server plugin/list exposes marketplaces with installed/enabled plugin records.
    for (const market of array(row(value).marketplaces)) {
      const m = row(market), marketplace = str(m.name);
      for (const plugin of array(m.plugins)) {
        const p = row(plugin), name = str(p.name), home = str(p.marketplaceName) || marketplace;
        if (!name || !home || p.installed !== true || p.enabled !== true) continue;
        const info = row(p.interface);
        result.push({ kind: 'plugin', name, label: str(info.displayName) || name,
          path: `plugin://${name}@${home}`,
          pluginId: str(p.id) || `${name}@${home}`,
          description: str(info.shortDescription),
          iconUrl: icon(info.composerIconUrl, info.composerIcon, info.logoUrl,
            info.logo, info.logoUrlDark, p.iconUrl) });
      }
    }
    return result;
  };
  const update = (kind: Mention['kind'], task: Promise<unknown>, parse: (x: unknown) => Mention[]) =>
    task.then((value) => {
      collected[kind] = parse(value);
      successful++;
      onUpdate?.(snapshot());
    }).catch(() => { /* Preserve cached entries of this category. */ });
  await Promise.all([
    update('skill', deadline(request('skills/list', {
      ...(cwd ? { cwds: [cwd] } : {}), forceReload: false,
    })), collectSkills),
    update('app', apps(), collectApps),
    update('plugin', plugins(), collectPlugins),
  ]);
  if (!successful) throw new Error('MENTION_CATALOG_UNAVAILABLE');
  return snapshot();
}

/** Trigger only at the caret; @ inside email addresses and completed words is ordinary text. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const prefix = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  // Chinese prose commonly puts @ directly after a Han character (请用@foo),
  // while Latin identifiers and email addresses must not trigger the menu.
  const hit = /(^|[\s([{（，。:：;；]|\p{Script=Han})@([^\s@]*)$/u.exec(prefix);
  return hit ? { start: prefix.length - hit[2].length - 1, query: hit[2] } : null;
}

export function filteredMentions(items: readonly Mention[], query: string): Mention[] {
  const byPlugin = new Map<string, Mention[]>();
  for (const item of items) {
    if (item.kind === 'skill' && item.pluginId) {
      const matches = byPlugin.get(item.pluginId) ?? [];
      matches.push(item);
      byPlugin.set(item.pluginId, matches);
    }
  }
  const q = query.toLocaleLowerCase();
  const order = { plugin: 0, app: 1, skill: 2 };
  // Do not briefly flash plugin-owned Skills while plugin/installed is still loading.
  return items.filter((item) => !(item.kind === 'skill' && item.pluginId)).filter((item) => {
    const children = item.kind === 'plugin' ? byPlugin.get(item.pluginId ?? '') ?? [] : [];
    const searchable = [item.label, item.name, item.description,
      ...children.flatMap((child) => [child.name, child.label, child.description])].join(' ');
    return searchable.toLocaleLowerCase().includes(q);
  }).map((item) => item.kind === 'plugin'
    ? { ...item, skillCount: byPlugin.get(item.pluginId ?? '')?.length ?? 0 }
    : item).sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 40);
}

/** Keep the UI's @ token in the text; native structured items carry the identity. */
export function selectedNativeMentions(text: string, selections: readonly Mention[]): NativeMention[] {
  const used: NativeMention[] = [];
  // A visible @name cannot distinguish two catalog records of the same name.
  // Prefer the last explicit picker selection instead of accidentally sending
  // both identities to Codex.
  const distinctNames = [...new Map(selections.map((item) => [item.name, item])).values()];
  for (const item of distinctNames) {
    if (!item.path || !item.name) continue;
    const token = '@' + item.name;
    let at = text.indexOf(token), matched = false;
    while (at >= 0) {
      const before = at === 0 || !/[\p{L}\p{N}_@]/u.test(text[at - 1]) ||
        /\p{Script=Han}/u.test(text[at - 1]);
      const next = text[at + token.length];
      const after = !next || !/[\p{L}\p{N}_-]/u.test(next) ||
        /\p{Script=Han}/u.test(next);
      if (before && after) { matched = true; break; }
      at = text.indexOf(token, at + token.length);
    }
    if (!matched) continue;
    if (!used.some((entry) => entry.path === item.path)) used.push({
      type: item.kind === 'skill' ? 'skill' : 'mention',
      name: item.name, path: item.path,
    });
  }
  return used.slice(0, 8);
}
