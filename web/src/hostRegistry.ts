import { validHostId, type Host } from './types.ts';

export function parseHosts(value: unknown): Host[] {
  if (!value || typeof value !== 'object') throw Error('INVALID_HOSTS');
  const record = value as Record<string, unknown>;
  if (record.primaryHostId !== '6v' || !Array.isArray(record.hosts) ||
      !record.hosts.length || record.hosts.length > 16) throw Error('INVALID_HOSTS');
  const seen = new Set<string>();
  const hosts = record.hosts.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw Error('INVALID_HOST');
    const { id, displayName } = item as Record<string, unknown>;
    if (!validHostId(id) || seen.has(id) || typeof displayName !== 'string' ||
        !displayName.trim() || displayName.length > 80) throw Error('INVALID_HOST');
    seen.add(id);
    return { id, displayName };
  });
  if (!seen.has('6v')) throw Error('INVALID_HOSTS');
  return hosts;
}

export async function fetchHosts(signal: AbortSignal): Promise<Host[]> {
  const response = await fetch('/api/hosts', { cache: 'no-store', signal });
  if (!response.ok) throw Error('HOSTS_UNAVAILABLE');
  return parseHosts(await response.json());
}
