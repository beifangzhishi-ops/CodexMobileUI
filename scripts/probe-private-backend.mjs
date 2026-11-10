import WebSocket from 'ws';

// Read-only probe of the MobileUI-owned native App Server.
// Output is intentionally limited to method acceptance, counts and auth presence.
const address = 'ws://127.0.0.1:45891';
const socket = new WebSocket(address, { handshakeTimeout: 3000 });
let seq = 0;
const pending = new Map();
const timeout = setTimeout(() => {
  console.error('private_backend_probe_timeout');
  process.exitCode = 1;
  socket.terminate();
}, 12000);

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
socket.on('message', (raw) => {
  let message;
  try { message = JSON.parse(String(raw)); } catch { return; }
  const current = pending.get(message.id);
  if (!current) return;
  pending.delete(message.id);
  if (message.error) current.reject(new Error(current.method + '_rpc_rejected'));
  else current.resolve(message.result);
});
socket.on('error', () => { console.error('private_backend_probe_connection_error'); process.exitCode = 1; });
socket.on('open', async () => {
  try {
    await request('initialize', {
      clientInfo: { name: 'codexmobileui_private_readonly_probe', version: '0.1.5' },
      capabilities: { experimentalApi: true },
    });
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));
    console.log('initialize_ok');

    const [threads, projects] = await Promise.all([
      request('thread/list', { limit: 100, modelProviders: [], sortKey: 'recency_at' }),
      request('project/list', { limit: 100 }),
    ]);
    if (!Array.isArray(threads?.data) || !Array.isArray(projects?.data)) {
      throw new Error('private_backend_schema_invalid');
    }
    console.log('private_threads=' + threads.data.length);
    console.log('private_projects=' + projects.data.length);

    // account/read is an optional read-only protocol method; only report
    // authentication presence, never print account data or auth objects.
    try {
      const status = await request('account/read', { refreshToken: false });
      console.log('account_present=' + Boolean(status?.account));
    } catch {
      console.log('account_status_unavailable');
    }
  } catch (error) {
    console.error(error.message.startsWith('private_') ? error.message : 'private_backend_rpc_failure');
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    socket.close();
  }
});
socket.on('close', () => {
  if (pending.size) process.exitCode = 1;
  clearTimeout(timeout);
});
