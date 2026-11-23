import type { HostId } from './types';

const LOCAL_HOSTS: readonly { host: HostId; port: number }[] = [
  { host: '6v', port: 4190 },
  { host: 'noha', port: 4191 },
];

/**
 * Do not infer the browser's computer from the Coordinator address, remote
 * thread host, or a default. Only the matching machine's loopback bridge can
 * confirm its identity. Unknown (including phones) remains unknown.
 */
export async function detectBrowserMachine(
  fetcher: typeof fetch = fetch,
  timeoutMs = 1800,
): Promise<HostId | null> {
  const responses = await Promise.all(LOCAL_HOSTS.map(async ({ host, port }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`http://127.0.0.1:${port}/api/local-machine`, {
        method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      return data && typeof data === 'object' && 'hostId' in data &&
        (data as { hostId: unknown }).hostId === host ? host : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }));
  const matches = responses.filter((host): host is HostId => host !== null);
  return matches.length === 1 ? matches[0] : null;
}
