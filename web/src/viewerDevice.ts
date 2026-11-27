import type { HostId } from './types.ts';

export const MOBILE_VIEWER = '@mobile' as const;
export type ViewerDevice = HostId | typeof MOBILE_VIEWER;

export function resolveViewerDevice(stored: string | null, hosts: readonly HostId[],
  nativeApp: boolean): ViewerDevice {
  if (nativeApp || stored === MOBILE_VIEWER) return MOBILE_VIEWER;
  if (stored && hosts.includes(stored)) return stored;
  return '6v';
}
