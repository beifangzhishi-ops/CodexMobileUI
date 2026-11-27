import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { WebSocket } from 'ws';

const MAX_EVENTS = 300;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_TITLE = 80;
const MAX_PREVIEW = 360;
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,256}$/.test(value);
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const subAgentThreadSources = new Set([
  'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther',
]);
const statusOf = (value) => {
  const status = plain(value).status;
  return ['completed', 'failed', 'interrupted'].includes(status) ? status : 'completed';
};
export const validCursor = (value) => value === null ||
  (Number.isSafeInteger(value) && value >= 0);

// A notification is not a native item viewer. Use only visible assistant text,
// never tool output, reasoning, file contents or any older completed turn.
function compact(value, limit) {
  if (typeof value !== 'string') return '';
  const clipped = value.slice(0, 16_384);
  return [...clipped
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/[*_~\x60]+/g, '')
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ').trim()].slice(0, limit).join('');
}

function itemText(item) {
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return '';
  return item.content.filter((part) => plain(part).type === 'text')
    .map((part) => plain(part).text).filter((text) => typeof text === 'string').join('\n');
}

// ThreadSource notifications contain only the thread/turn IDs. A matching
// thread/read snapshot is the available authority for native child metadata.
// Missing or mismatched snapshots remain unknown, so ordinary alerts proceed.
function isSubAgentThread(snapshot, threadId) {
  const thread = plain(plain(snapshot).thread);
  if (thread.id !== threadId) return false;
  if (typeof thread.parentThreadId === 'string' && thread.parentThreadId) return true;
  if (Object.hasOwn(plain(thread.source), 'subAgent')) return true;
  return typeof thread.threadSource === 'string' && subAgentThreadSources.has(thread.threadSource);
}

export function notificationContentFromRead(snapshot, turnId, completedTurn) {
  const thread = plain(plain(snapshot).thread);
  let title = compact(thread.name || thread.title, MAX_TITLE);
  if (!title) {
    let preview = typeof thread.preview === 'string' ? thread.preview : '';
    const separator = '\n\n## My request for Codex:\n\n';
    if (preview.startsWith('# Files mentioned by the user:')) {
      const at = preview.indexOf(separator);
      preview = at >= 0 ? preview.slice(at + separator.length) : '文件';
    }
    title = compact(preview, MAX_TITLE);
  }
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const matching = turns.find((turn) => plain(turn).id === turnId);
  const completed = plain(completedTurn);
  // App Server completion notifications can precede the thread/read snapshot.
  const items = Array.isArray(plain(matching).items) ? matching.items
    : completed.id === turnId && Array.isArray(completed.items) ? completed.items : [];
  const answers = items.filter((entry) => plain(entry).type === 'agentMessage')
    .map((entry) => plain(entry))
    .filter((entry) => itemText(entry).trim());
  const final = answers.findLast((entry) => ['final_answer', 'final'].includes(entry.phase))
    ?? answers.filter((entry) => !['commentary', 'analysis'].includes(entry.phase)).at(-1);
  const reply = compact(final ? itemText(final) : '', MAX_PREVIEW);
  if (!title && turns.length) {
    const firstTurn = plain(turns[0]);
    const firstUser = (Array.isArray(firstTurn.items) ? firstTurn.items : [])
      .find((entry) => plain(entry).type === 'userMessage');
    title = compact(firstUser ? itemText(plain(firstUser)) : '', MAX_TITLE);
  }
  return { title: title || '新对话', preview: reply };
}

/** One private 6v-owned event log for both native App Servers. */
export class NotificationFeed {
  constructor(path, acceptsHost = (id) => id === '6v' || id === 'noha') {
    this.path = path;
    this.acceptsHost = acceptsHost;
    this.sequence = 0;
    this.events = [];
    this.clients = new Set();
    this.seen = new Set();
    this.pending = new Set();
    this.titleReaders = new Map();
    try {
      if (existsSync(path)) {
        const state = JSON.parse(readFileSync(path, 'utf8'));
        if (Number.isSafeInteger(state.sequence) && state.sequence >= 0 &&
            Array.isArray(state.events)) {
          this.sequence = state.sequence;
          this.events = state.events.filter((e) => e && Number.isSafeInteger(e.seq) &&
            this.acceptsHost(e.hostId) &&
            validId(e.threadId) && validId(e.turnId) &&
            typeof e.at === 'number' && e.at > Date.now() - MAX_AGE)
            .slice(-MAX_EVENTS).map((e) => ({
              seq: e.seq, hostId: e.hostId, threadId: e.threadId, turnId: e.turnId,
              status: statusOf(e), title: compact(e.title, MAX_TITLE) || '新对话',
              preview: compact(e.preview, MAX_PREVIEW), at: e.at,
            }));
        }
      }
    } catch { /* Malformed log is ignored; the live watcher can continue. */ }
    for (const event of this.events) this.seen.add(event.hostId + ':' + event.turnId);
  }

  persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = this.path + '.partial';
    writeFileSync(temp, JSON.stringify({ sequence: this.sequence, events: this.events }), { mode: 0o600 });
    renameSync(temp, this.path);
  }

  async observe(hostId, params, resolveThread = async () => null) {
    const p = plain(params);
    const threadId = p.threadId;
    const turn = plain(p.turn);
    const turnId = turn.id || p.turnId;
    if (!this.acceptsHost(hostId) || !validId(threadId) || !validId(turnId)) return;
    const key = hostId + ':' + turnId;
    if (this.seen.has(key) || this.pending.has(key)) return;
    this.pending.add(key);
    try {
      let snapshot = null;
      try { snapshot = await resolveThread(hostId, threadId, turnId); }
      catch { /* A read failure must not suppress the completion notification. */ }
      if (this.seen.has(key)) return;
      if (isSubAgentThread(snapshot, threadId)) return;
      const { title, preview } = notificationContentFromRead(snapshot, turnId, turn);
      const event = { seq: ++this.sequence, hostId, threadId, turnId,
        status: statusOf(turn), title, preview, at: Date.now() };
      this.events.push(event);
      this.events = this.events.filter((e) => e.at > Date.now() - MAX_AGE).slice(-MAX_EVENTS);
      this.seen = new Set(this.events.map((e) => e.hostId + ':' + e.turnId));
      this.persist();
      for (const send of this.clients) send(event);
    } finally { this.pending.delete(key); }
  }

  subscribe(socket) {
    let subscribed = false;
    const send = (event) => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'event', event }));
    };
    const timeout = setTimeout(() => socket.close(1008, 'subscribe timeout'), 10_000);
    socket.on('message', (bytes, binary) => {
      if (subscribed || binary || bytes.length > 128) { socket.close(1008, 'invalid subscription'); return; }
      let request;
      try { request = JSON.parse(String(bytes)); } catch { socket.close(1008); return; }
      if (request?.type !== 'subscribe' || !validCursor(request.after)) {
        socket.close(1008, 'invalid cursor'); return;
      }
      subscribed = true;
      clearTimeout(timeout);
      // Fresh devices start at the current cursor. Reconnecting devices replay
      // the bounded history, with client-side seq deduplication.
      const baseline = request.after === null ? this.sequence : request.after;
      const events = this.events.filter((event) => event.seq > baseline);
      socket.send(JSON.stringify({ type: 'replay', events, latest: this.sequence }));
      this.clients.add(send);
    });
    socket.on('close', () => { clearTimeout(timeout); this.clients.delete(send); });
  }
}

/** Watch native completion independently of WebView/browser connections. */
export function watchNativeCompletions(feed, hostId, endpoint, headers = {}) {
  let socket = null;
  let attempt = 0;
  let timer = null;
  let closed = false;
  let nextId = 1;
  const requests = new Map();
  function connect() {
    if (closed) return;
    const ws = new WebSocket(endpoint, { headers, perMessageDeflate: false, handshakeTimeout: 10_000 });
    socket = ws;
    let ready = false;
    const relay = endpoint.includes('/peer');
    ws.on('open', () => {
      if (!relay) initialize();
    });
    function initialize() {
      ws.send(JSON.stringify({ id: 1, method: 'initialize', params: {
        // The peer agent validates the shared Web client identity rather
        // than accepting arbitrary new native client names.
        clientInfo: { name: relay ? 'codex_multi_host_web' : 'codex_mobile_notifications',
          title: 'CodexMobileUI Notifications', version: '0.1.0' },
        capabilities: { experimentalApi: true, requiredHumanApproval: false },
      } }));
    }
    function requestThread(threadId) {
      if (!ready || requests.size >= 16) return Promise.resolve(null);
      const id = ++nextId;
      return new Promise((resolvePromise) => {
        const timeout = setTimeout(() => { requests.delete(id); resolvePromise(null); }, 5_000);
        requests.set(id, (data) => {
          clearTimeout(timeout);
          resolvePromise(data.result ?? null);
        });
        // Both native endpoints must include turns to extract the current
        // final answer; noha's existing allowlist also requires true.
        ws.send(JSON.stringify({ id, method: 'thread/read', params: {
          threadId, includeTurns: true,
        } }));
      });
    }
    async function readCompletedTurn(_host, threadId, turnId) {
      let snapshot = null;
      for (let i = 0; i < 3; i++) {
        snapshot = await requestThread(threadId);
        const turns = plain(plain(snapshot).thread).turns;
        if (Array.isArray(turns) && turns.some((turn) =>
          plain(turn).id === turnId && Array.isArray(plain(turn).items))) break;
        if (i < 2 && ready) await new Promise((resolve) => setTimeout(resolve, 200 * (i + 1)));
      }
      return snapshot;
    }
    ws.on('message', (bytes, binary) => {
      if (binary) return;
      let frame;
      try { frame = JSON.parse(String(bytes)); } catch { return; }
      if (relay && frame?.type === 'ready') {
        initialize();
      } else if (frame?.id === 1 && !frame.method) {
        if (frame.error) { ws.close(); return; }
        ready = true;
        attempt = 0;
        feed.titleReaders.set(hostId, readCompletedTurn);
        ws.send(JSON.stringify({ method: 'initialized', params: {} }));
      } else if (typeof frame?.id === 'number' && !frame.method) {
        const finish = requests.get(frame.id);
        requests.delete(frame.id);
        finish?.(frame);
      } else if (frame?.method === 'turn/completed' && ready) {
        void feed.observe(hostId, frame.params, readCompletedTurn).catch(() => undefined);
      } else if (typeof frame?.id === 'number' && frame.method) {
        // A monitoring connection must never grant native approvals.
        ws.send(JSON.stringify({ id: frame.id, error: { code: -32000,
          message: 'Notification monitor cannot approve requests' } }));
      }
    });
    const reconnect = () => {
      if (socket !== ws || closed) return;
      feed.titleReaders.delete(hostId);
      for (const finish of requests.values()) finish({});
      requests.clear();
      socket = null;
      const delay = Math.min(30_000, 1500 * 2 ** Math.min(attempt++, 5));
      timer = setTimeout(connect, delay);
    };
    ws.once('close', reconnect);
    ws.once('error', () => { ws.close(); });
  }
  connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    if (socket) socket.close();
  };
}
