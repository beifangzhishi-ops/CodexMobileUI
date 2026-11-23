import type { HostId } from './types';

type DesktopBridge = {
  openMenu?: (id: 'file' | 'edit' | 'view' | 'window', x: number, y: number) => void;
  revealFile: (hostId: HostId, path: string) => Promise<{ ok: boolean; error?: string }>;
  localHost?: () => Promise<HostId>;
  syncPathHosts?: (hosts: Record<HostId, { ip: string; share: string }>) =>
    Promise<{ ok: boolean }>;
  filePath?: (file: File) => string;
};

/** The native bridge is injected only by the Windows desktop shell. */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { codexDesktop?: DesktopBridge }).codexDesktop;
  return typeof bridge?.revealFile === 'function' ? bridge : null;
}
