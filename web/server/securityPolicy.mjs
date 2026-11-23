/**
 * The coordinator is restricted to the trusted tailnet HTTP origin. CSP is
 * defense in depth, not a reason to block legitimate HTTPS catalog artwork
 * or same-origin WebSocket conversations on browsers that do not treat `self`
 * as covering ws: URLs.
 */
export function webContentSecurityPolicy(origin) {
  const address = new URL(origin);
  if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password ||
      address.pathname !== '/' || address.search || address.hash) {
    throw new Error('INVALID_WEB_ORIGIN');
  }
  const websocket = (address.protocol === 'https:' ? 'wss://' : 'ws://') + address.host;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    `connect-src 'self' ${websocket} http://127.0.0.1:4190 http://127.0.0.1:4191`,
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}
