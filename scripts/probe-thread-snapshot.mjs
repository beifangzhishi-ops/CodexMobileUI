/**
 * Read-only compatibility check against the already-running local Codex
 * App Server. Prints structure/counts only, never IDs, paths, titles or text.
 * Sends initialize, initialized, thread/list, thread/read; no resume or turn.
 */
import WebSocket from 'ws';

const target = process.env.CODEX_APP_SERVER_WS ?? 'ws://127.0.0.1:45891';
const url = new URL(target);
if (url.protocol !== 'ws:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
  throw new Error('Read-only probe only permits the local shared Codex App Server');
}

const socket = new WebSocket(target, { handshakeTimeout: 5000, maxPayload: 64 * 1024 * 1024 });
let closed = false;
const timer = setTimeout(() => finish('readonly_snapshot_timeout', true), 15000);
function finish(outcome, failed = false) {
  if (closed) return;
  closed = true;
  clearTimeout(timer);
  console.log(outcome);
  if (failed) process.exitCode = 1;
  socket.close();
}
function send(id, method, params) {
  socket.send(JSON.stringify({ id, method, params }));
}
socket.on('open', () => send(1, 'initialize', {
  clientInfo: { name: 'codexmobileui_snapshot_readonly_probe', version: '0.1.0' },
  capabilities: { experimentalApi: true },
}));
socket.on('message', (bytes) => {
  if (closed) return;
  let reply;
  try { reply = JSON.parse(String(bytes)); } catch { return; }
  if (reply.id === 1) {
    if (reply.error) return finish('readonly_snapshot_initialize_failed', true);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));
    send(2, 'thread/list', { limit: 5, sortKey: 'recency_at' });
    return;
  }
  if (reply.id === 2) {
    if (reply.error) return finish('readonly_snapshot_list_failed', true);
    const threads = Array.isArray(reply.result?.data) ? reply.result.data : [];
    if (!threads.length) return finish('readonly_snapshot_no_threads');
    const first = threads.find((thread) => typeof thread?.id === 'string');
    if (!first) return finish('readonly_snapshot_missing_thread_id', true);
    send(3, 'thread/read', { threadId: first.id, includeTurns: true });
    return;
  }
  if (reply.id === 3) {
    if (reply.error) {
      console.log('readonly_snapshot_read_error_code=' + String(reply.error.code ?? 'unknown'));
      return finish('readonly_snapshot_read_failed', true);
    }
    const thread = reply.result?.thread;
    if (!thread || !Array.isArray(thread.turns)) {
      const fields = Object.keys(reply.result ?? {}).filter((key) => /^[a-zA-Z]+$/.test(key));
      console.log('readonly_snapshot_response_fields=' + fields.join(','));
      return finish('readonly_snapshot_missing_turns', true);
    }
    const types = {};
    let messages = 0;
    let textMessages = 0;
    let renderableMessages = 0;
    const contentTypes = new Set();
    for (const turn of thread.turns) {
      if (!Array.isArray(turn?.items)) continue;
      for (const item of turn.items) {
        const kind = String(item?.type ?? 'unknown');
        types[kind] = (types[kind] ?? 0) + 1;
        if (kind === 'userMessage' || kind === 'agentMessage') {
          messages += 1;
          if (typeof item.text === 'string' || Array.isArray(item.content)) textMessages += 1;
          const parts = Array.isArray(item.content) ? item.content : [];
          for (const part of parts) {
            const type = typeof part?.type === 'string' &&
              /^[a-zA-Z_]{1,32}$/.test(part.type) ? part.type : 'other';
            contentTypes.add(type);
          }
          const availableText = typeof item.text === 'string' ? item.text
            : parts.filter((part) => part?.type === 'text' && typeof part.text === 'string')
              .map((part) => part.text).join('\n');
          if (availableText.length) renderableMessages += 1;
        }
      }
    }
    console.log('readonly_snapshot_turn_count=' + thread.turns.length);
    console.log('readonly_snapshot_message_items=' + messages);
    console.log('readonly_snapshot_text_candidates=' + textMessages);
    console.log('readonly_snapshot_renderable_messages=' + renderableMessages);
    console.log('readonly_snapshot_content_types=' + [...contentTypes].sort().join(','));
    console.log('readonly_snapshot_item_types=' + Object.keys(types).sort().join(','));
    return finish('readonly_snapshot_read_ok');
  }
});
socket.on('error', () => finish('readonly_snapshot_connection_failed', true));
socket.on('close', () => {
  if (!closed) finish('readonly_snapshot_connection_closed', true);
});
