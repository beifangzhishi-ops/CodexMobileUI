/**
 * On-host read-only interoperability probe for an ALREADY running shared
 * Codex App Server. Sends only initialize/initialized/thread/list.
 * Prints status, never thread names, paths, IDs, tokens, or conversation text.
 */
import WebSocket from 'ws';

const address = process.env.CODEX_APP_SERVER_WS ?? 'ws://127.0.0.1:45789';
const url = new URL(address);
if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  console.error('Probe allows only a local, non-public shared Codex WS address');
  process.exitCode = 1;
} else {
  const socket = new WebSocket(address, { handshakeTimeout: 3000 });
  let finished = false;
  const timer = setTimeout(() => {
    if (!finished) console.error('readonly_probe_timeout');
    process.exitCode = 1;
    socket.terminate();
  }, 6000);
  const finish = (message, failed = false) => {
    if (finished) return;
    finished = true;
    console.log(message);
    if (failed) process.exitCode = 1;
    clearTimeout(timer);
    socket.close();
  };
  socket.on('open', () => socket.send(JSON.stringify({
    id: 1,
    method: 'initialize',
    params: {
      clientInfo: { name: 'codexmobileui_readonly_probe', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    },
  })));
  socket.on('message', (bytes) => {
    let message;
    try { message = JSON.parse(String(bytes)); }
    catch { return; }
    if (message.id === 1) {
      if (message.error) { finish('readonly_init_rejected', true); return; }
      socket.send(JSON.stringify({ method: 'initialized', params: {} }));
      socket.send(JSON.stringify({
        id: 2, method: 'thread/list', params: { limit: 1, sortKey: 'recency_at' },
      }));
    } else if (message.id === 2) {
      finish(message.error ? 'readonly_thread_list_rejected' : 'readonly_thread_list_ok', !!message.error);
    }
  });
  socket.on('error', (error) => finish('readonly_connection_error:' + (error.code ?? 'unknown'), true));
  socket.on('close', () => {
    if (!finished) finish('readonly_connection_closed', true);
  });
}
