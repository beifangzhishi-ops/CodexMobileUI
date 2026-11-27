import { validHostId, type HostId } from './types.ts';

export type PathHosts = Record<HostId, { ip: string; share: string }>;
export const defaultPathHosts: PathHosts = {
  '6v': { ip: '100.76.74.124', share: '6v1f' },
  noha: { ip: '100.96.30.32', share: 'noha' },
};

export function parsePathHosts(value: unknown): PathHosts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_PATH_HOSTS');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length > 16 || !Object.keys(data).every(validHostId)) throw Error('INVALID_PATH_HOSTS');
  const parsed = {} as PathHosts;
  for (const id of Object.keys(data)) {
    const entry = data[id];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('INVALID_PATH_HOSTS');
    const { ip, share } = entry as Record<string, unknown>;
    if (typeof ip !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) ||
        ip.split('.').some((segment) => Number(segment) > 255) ||
        typeof share !== 'string' || !/^[\w$-]{1,40}$/.test(share)) throw Error('INVALID_PATH_HOSTS');
    parsed[id] = { ip, share };
  }
  return parsed;
}

export async function fetchPathHosts(): Promise<PathHosts> {
  const response = await fetch('/api/file-path-hosts', { cache: 'no-store' });
  if (!response.ok) throw Error('PATH_HOSTS_UNAVAILABLE');
  return parsePathHosts(await response.json());
}

export async function savePathHosts(hosts: PathHosts): Promise<PathHosts> {
  const response = await fetch('/api/file-path-hosts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hosts),
  });
  if (!response.ok) throw Error('PATH_HOSTS_SAVE_FAILED');
  return parsePathHosts(await response.json());
}

export function pathForViewer(path: string, origin: HostId, viewer: HostId | null,
  hosts: PathHosts): string {
  if (!viewer) return path;
  const normalized = path.replace(/\//g, '\\');
  for (const id of Object.keys(hosts)) {
    const prefix = '\\\\' + hosts[id].ip + '\\' + hosts[id].share + '\\';
    if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
      const suffix = normalized.slice(prefix.length);
      return viewer === id ? 'C:\\' + suffix : prefix + suffix;
    }
  }
  if (!/^[Cc]:[\\/]/.test(path)) return path;
  if (viewer === origin) return normalized;
  if (!Object.hasOwn(hosts, origin)) return path;
  return '\\\\' + hosts[origin].ip + '\\' + hosts[origin].share + '\\' + normalized.slice(3);
}

export function hasAbsolutePaths(text: string): boolean {
  return /[A-Za-z]:[\\/]|\\\\[\w.-]+\\[\w$.-]+\\/.test(text);
}
