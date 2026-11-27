import { validHostId, type HostId } from './types.ts';

export type SidebarPin = { type: 'project' | 'thread'; hostId: HostId; id: string };
export type SidebarPinsSnapshot = { revision: number; items: SidebarPin[] };

export function parseSidebarPins(value: unknown): SidebarPinsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_PINS');
  const data = value as Record<string, unknown>;
  if (typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.items) || data.items.length > 300 || !data.items.every((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const p = item as Record<string, unknown>;
        return Object.keys(p).length === 3 && (p.type === 'project' || p.type === 'thread') &&
          validHostId(p.hostId) && typeof p.id === 'string' && /^[\w-]{1,128}$/.test(p.id);
      })) throw Error('INVALID_PINS');
  return data as SidebarPinsSnapshot;
}

export async function fetchSidebarPins(): Promise<SidebarPinsSnapshot> {
  const response = await fetch('/api/sidebar-pins', { cache: 'no-store' });
  if (!response.ok) throw Error('PINS_UNAVAILABLE');
  return parseSidebarPins(await response.json());
}

export async function setSidebarPin(pin: SidebarPin, pinned: boolean): Promise<SidebarPinsSnapshot> {
  const response = await fetch('/api/sidebar-pins', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, pinned }), cache: 'no-store',
  });
  if (!response.ok) throw Error('PINS_UNAVAILABLE');
  return parseSidebarPins(await response.json());
}
