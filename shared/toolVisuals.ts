/** Presentation metadata only. Never treat an icon address as an executable or host path. */
export type ToolLogo = { id: string; name: string; url: string };
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value !== null && typeof value === 'object' &&
  !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === 'string' ? value : '';
const arr = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function safeToolLogoUrl(value: unknown): string {
  const icon = (candidate: unknown, depth = 0): string => {
    if (typeof candidate === 'string') return candidate;
    if (depth >= 3) return '';
    const fields = row(candidate);
    for (const key of ['url', 'uri', 'dark', 'small', 'light', 'default', 'large', 'image', 'src']) {
      const found = icon(fields[key], depth + 1);
      if (found) return found;
    }
    return '';
  };
  const raw = icon(value);
  if (!raw || raw.length > 2048) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

export function parseToolLogos(appList: unknown, pluginList?: unknown): ToolLogo[] {
  const result: ToolLogo[] = [];
  const add = (id: string, name: string, icon: unknown) => {
    const url = safeToolLogoUrl(icon);
    if (id && id.length < 180 && url && !result.some((item) => item.id === id))
      result.push({ id, name: name || id, url });
  };
  for (const value of arr(row(appList).data)) {
    const app = row(value);
    const id = str(app.id), name = str(app.name) || id;
    const icon = app.logoUrl ?? app.iconUrl ?? app.logo ?? app.icon ??
      row(app.icons).small ?? row(app.logoUrls).small ??
      row(app.branding).logo ?? row(app.interface).icon ?? app.imageUrl;
    add(id, name, icon);
    if (name && name !== id) add(name, name, icon);
  }
  const root = row(pluginList);
  const pluginEntries = [
    ...arr(root.data), ...arr(root.plugins), ...arr(root.installedPlugins),
    ...arr(root.marketplaces).flatMap((marketValue) => arr(row(marketValue).plugins)),
  ];
  for (const value of pluginEntries) {
      const plugin = row(value);
      const id = str(plugin.id) || str(plugin.name);
      const name = str(plugin.displayName) || str(plugin.name) || id;
      const icon = plugin.logoUrl ?? plugin.iconUrl ?? plugin.logo ?? plugin.icon ??
        row(plugin.interface).icon ?? row(plugin.interface).logoUrl ??
        row(plugin.icons).small;
      add(id, name, icon);
      if (name && name !== id) add(name, name, icon);
  }
  return result.slice(0, 300);
}

export function findToolLogo(logos: readonly ToolLogo[], pluginId?: string,
  appId?: string): ToolLogo | undefined {
  const keys = [appId, pluginId].filter((value): value is string => !!value);
  return keys.length ? logos.find((logo) => keys.includes(logo.id)) : undefined;
}

export function toolDisplayName(type: string | undefined, title: string | undefined,
  content: string, server?: string, tool?: string): string {
  if (type === 'commandExecution') return content.trim() || '命令';
  if (type === 'imageView') return content.split(/[\\/]/).filter(Boolean).at(-1) || '图片';
  if (type === 'mcpToolCall' || type === 'dynamicToolCall') {
    return [server, tool].filter(Boolean).join(' · ') || content.replace(/\s*\/\s*/, ' · ') || '工具';
  }
  if (type === 'fileChange') return content.trim() || '修改文件';
  if (content.trim()) return content.replace(/\s+/g, ' ').trim();
  return title || '工具';
}
