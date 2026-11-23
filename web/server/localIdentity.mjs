/**
 * Local-only browser identity proof. A remote Coordinator URL is not evidence
 * of which Windows computer runs the browser; the loopback listener is.
 * This deliberately exposes no other agent endpoints through CORS.
 */
export function respondLocalIdentity(req, res, { hostId, port, origin }) {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/api/local-machine') return false;
  const local = req.socket.remoteAddress === '127.0.0.1' &&
    req.headers.host === `127.0.0.1:${port}`;
  const trusted = req.headers.origin === origin;
  if (!local || !trusted || !['GET', 'OPTIONS'].includes(req.method)) {
    res.writeHead(403); res.end(); return true;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  // Some Chromium versions preflight a public/tailnet-to-loopback request.
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.writeHead(204); res.end(); return true;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ hostId }));
  return true;
}
