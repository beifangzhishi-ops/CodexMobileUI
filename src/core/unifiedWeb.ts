/** The shared Web UI uses the private Tailscale Serve HTTPS origin. */
export function unifiedWebUrl(coordinatorUrl: string | null): string | null {
  if (!coordinatorUrl) return null;
  try {
    const url = new URL(coordinatorUrl.trim());
    if (url.protocol !== 'https:' || url.port !== '4190' ||
        !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
