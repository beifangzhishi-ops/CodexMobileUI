import http from 'node:http';
import { createReadStream, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

// This file is copied unchanged to noha's host-only bundle for agent mode.
// Neither endpoint ever listens on a non-loopback interface.
const mode = process.argv[2];
if (!['coordinator', 'agent'].includes(mode)) throw Error('Expected coordinator or agent');
const scriptDir = dirname(fileURLToPath(import.meta.url));
process.chdir(mode === 'coordinator' ? resolve(scriptDir, '../..') : resolve(scriptDir, '..'));
const config = JSON.parse(readFileSync(resolve('.state/web-bridge.json'), 'utf8').replace(/^\uFEFF/, ''));
const credential = readFileSync(resolve('.state/web-peer-token'), 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(credential)) throw Error('Missing strong peer credential');
const coordinator = mode === 'coordinator';
if (coordinator && (config.origin !== 'http://100.76.74.124:4190' ||
  config.peerUrl !== 'ws://100.96.30.32:4191/peer')) throw Error('Invalid private IP configuration');
const port = coordinator ? 4190 : 4191;
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });
const assets = resolve('web/dist');
const allowedAssets = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.ico', 'image/x-icon'],
]);
let currentConnections = 0;
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function browserAuthorized(req) {
  // The browser has no login. Restrict the HTTP Host to the chosen private
  // Tailscale IP:port; the tailnet TCP forwarder is its only remote listener.
  return coordinator && req.headers.host === new URL(config.origin).host;
}
function privatePeerAuthorized(req) {
  return req.socket.remoteAddress === '127.0.0.1' &&
    safeEqual(req.headers.authorization, 'Bearer ' + credential);
}
function reject(socket, code = 403) {
  socket.end('HTTP/1.1 ' + code + ' Forbidden\r\nConnection: close\r\n\r\n');
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/healthz' && req.socket.remoteAddress === '127.0.0.1') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return;
  }
  if (!coordinator || !browserAuthorized(req) || req.method !== 'GET') {
    res.writeHead(403); res.end(); return;
  }
  const name = new URL(req.url ?? '/', 'http://localhost').pathname;
  const relative = name === '/' ? '/index.html' : name;
  let decoded;
  try { decoded = decodeURIComponent(relative); } catch { res.writeHead(400); res.end(); return; }
  const target = resolve(assets, '.' + decoded);
  if (!target.startsWith(assets + sep) || !allowedAssets.has(extname(target)) || !existsSync(target)) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', allowedAssets.get(extname(target)));
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  createReadStream(target).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); }).pipe(res);
});

// Browser may only make these bounded RPC calls. In particular, no cwd, arbitrary
// native filesystem operations, full access, or unbounded sandbox overrides.
function validId(x) { return typeof x === 'string' && x.length > 0 && x.length <= 128; }
function subset(p, keys) { return Object.keys(p).every((key) => keys.includes(key)); }
function validPermissions(p) {
  if (!subset(p, ['permissions','approvalsReviewer'])) return false;
  if (p.permissions === undefined) return p.approvalsReviewer === undefined;
  if (![':workspace', ':read-only', ':danger-full-access'].includes(p.permissions)) return false;
  if (p.approvalsReviewer !== undefined && !['user','auto_review'].includes(p.approvalsReviewer)) return false;
  return p.permissions !== ':danger-full-access' || p.approvalsReviewer !== 'auto_review';
}
function validTextInput(input) {
  return Array.isArray(input) && input.length === 1 && input[0]?.type === 'text' &&
    typeof input[0]?.text === 'string' && input[0].text.trim().length > 0 &&
    input[0].text.length <= 12_000 && subset(input[0], ['type','text']);
}
function validCollaborationMode(mode, model) {
  if (mode === undefined) return true;
  if (!mode || typeof mode !== 'object' || !subset(mode, ['mode','settings']) ||
      !['default','plan'].includes(mode.mode)) return false;
  const settings = mode.settings;
  return settings && typeof settings === 'object' &&
    subset(settings, ['model','reasoning_effort','developer_instructions']) &&
    typeof settings.model === 'string' && /^[\w.-]{1,80}$/.test(settings.model) &&
    settings.model === model &&
    (settings.reasoning_effort === null ||
      ['minimal','low','medium','high','xhigh','max','ultra'].includes(settings.reasoning_effort)) &&
    settings.developer_instructions === null;
}
function allowedFrame(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  if (msg.method === 'initialized') return msg.id === undefined && subset(msg, ['method', 'params']);
  if (!Number.isSafeInteger(msg.id) || msg.id < 1 || msg.id > 999999999 ||
      typeof msg.method !== 'string' || !msg.params || typeof msg.params !== 'object' ||
      Array.isArray(msg.params) || !subset(msg, ['id', 'method', 'params'])) return false;
  const p = msg.params;
  if (msg.method === 'web/start') return subset(p, ['projectId','permissions','approvalsReviewer']) &&
    (p.projectId === null || validId(p.projectId)) &&
    validPermissions(Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'projectId')));
  if (msg.method === 'initialize') return subset(p, ['clientInfo', 'capabilities']) &&
    p.clientInfo?.name === 'codex_multi_host_web' && p.clientInfo?.version === '0.1.0';
  if (msg.method === 'project/list') return subset(p, ['limit', 'cursor']) &&
    (p.limit === undefined || Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= 100) &&
    (p.cursor === undefined || validId(p.cursor));
  if (msg.method === 'thread/list') return subset(p, ['limit', 'cursor', 'archived', 'sortKey', 'modelProviders']) &&
    p.limit === 100 && p.sortKey === 'recency_at' && Array.isArray(p.modelProviders) && p.modelProviders.length === 0 &&
    (p.archived === undefined || p.archived === true) && (p.cursor === undefined || validId(p.cursor));
  if (msg.method === 'thread/read') return subset(p, ['threadId', 'includeTurns']) &&
    validId(p.threadId) && p.includeTurns === true;
  if (msg.method === 'thread/resume') return subset(p, ['threadId']) && validId(p.threadId);
  if (msg.method === 'project/read') return subset(p, ['projectId']) && validId(p.projectId);
  if (msg.method === 'model/list') return subset(p, ['limit', 'cursor']) &&
    (p.limit === undefined || p.limit === 100) && (p.cursor === undefined || validId(p.cursor));
  if (msg.method === 'permissionProfile/list') return Object.keys(p).length === 0;
  if (msg.method === 'turn/start') return subset(p, ['threadId','input','model','effort',
    'permissions','approvalsReviewer','collaborationMode']) &&
    validId(p.threadId) && validTextInput(p.input) &&
    (p.model === undefined || typeof p.model === 'string' && /^[\w.-]{1,80}$/.test(p.model)) &&
    (p.effort === undefined || ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(p.effort)) &&
    validPermissions(Object.fromEntries(Object.entries(p).filter(([key]) => ['permissions','approvalsReviewer'].includes(key)))) &&
    validCollaborationMode(p.collaborationMode, p.model);
  if (msg.method === 'turn/steer') return subset(p, ['threadId','input','expectedTurnId']) &&
    validId(p.threadId) && validId(p.expectedTurnId) && validTextInput(p.input);
  if (msg.method === 'thread/queue/list') return subset(p, ['threadId','limit','cursor']) &&
    validId(p.threadId) && p.limit === 100 && (p.cursor === undefined || validId(p.cursor));
  if (msg.method === 'thread/queue/add') return subset(p, ['threadId','clientUserMessageId','input']) &&
    validId(p.threadId) && validId(p.clientUserMessageId) && validTextInput(p.input);
  if (msg.method === 'thread/queue/delete' || msg.method === 'thread/queue/start') {
    return subset(p, ['threadId','queuedSubmissionId']) && validId(p.threadId) && validId(p.queuedSubmissionId);
  }
  if (msg.method === 'thread/goal/get') return subset(p, ['threadId']) && validId(p.threadId);
  if (msg.method === 'thread/goal/clear') return subset(p, ['threadId','origin']) &&
    validId(p.threadId) && p.origin === 'user';
  if (msg.method === 'thread/goal/set') return subset(p, ['threadId','origin','objective','status']) &&
    validId(p.threadId) && p.origin === 'user' &&
    ((p.status === 'active' && p.objective === undefined) ||
      (p.status === undefined && typeof p.objective === 'string' &&
      p.objective.trim().length > 0 && [...p.objective].length <= 4000 && !p.objective.includes('\0')));
  if (msg.method === 'turn/interrupt') return subset(p, ['threadId', 'turnId']) &&
    validId(p.threadId) && validId(p.turnId);
  if (msg.method === 'thread/archive' || msg.method === 'thread/unarchive') {
    return subset(p, ['threadId']) && validId(p.threadId);
  }
  return false;
}

function attachRelay(browser, upstreamUrl, headers = {}) {
  const remotePeer = typeof headers.Authorization === 'string';
  const upstream = new WebSocket(upstreamUrl, { headers, perMessageDeflate: false, handshakeTimeout: 10000, maxPayload: 16 * 1024 * 1024 });
  let upstreamReady = false;
  const pendingApprovals = new Set();
  const pendingInternal = new Map();
  let internalId = 1_000_000_000;
  const internalRequest = (method, params) => new Promise((resolvePromise, rejectPromise) => {
    if (!upstreamReady) { rejectPromise(Error('HOST_OFFLINE')); return; }
    const id = internalId++;
    const timer = setTimeout(() => { pendingInternal.delete(id); rejectPromise(Error('NATIVE_TIMEOUT')); }, 15000);
    pendingInternal.set(id, { resolvePromise, rejectPromise, timer });
    upstream.send(JSON.stringify({ id, method, params }));
  });
  const safeSend = (frame) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(String(frame), { binary: false });
  };
  async function prepareStart(request) {
    const projectId = request.params.projectId;
    let cwd;
    if (projectId === null) {
      // Host-owned generated directory; browser cannot provide or choose a path.
      const local = process.env.LOCALAPPDATA;
      if (!local) throw Error('LOCAL_PROFILE_MISSING');
      cwd = join(local, 'CodexMobileUI', 'CodexHome', 'web-workspaces', 'web-' + randomUUID());
      mkdirSync(cwd, { recursive: true });
    } else {
      const result = await internalRequest('project/read', { projectId });
      const project = result?.project;
      if (!project || project.id !== projectId || !Array.isArray(project.roots)) throw Error('PROJECT_UNAVAILABLE');
      const root = project.roots.map((r) => typeof r === 'string' ? r : r?.path)
        .find((r) => typeof r === 'string' && /^[A-Za-z]:[\\/]/.test(r));
      if (!root) throw Error('PROJECT_ROOT_UNAVAILABLE');
      cwd = root;
    }
    const requested = { ...(request.params.permissions ? { permissions: request.params.permissions } : {}),
      ...(request.params.approvalsReviewer ? { approvalsReviewer: request.params.approvalsReviewer } : {}) };
    if (requested.permissions) {
      const profiles = await internalRequest('permissionProfile/list', {});
      if (!Array.isArray(profiles?.data) ||
          !profiles.data.some((profile) => profile?.id === requested.permissions && profile.allowed === true))
        throw Error('PERMISSION_NOT_ALLOWED');
    }
    return internalRequest('thread/start', { cwd, ...(projectId ? { projectId } : {}),
      ...requested, ...(!projectId && !requested.permissions ? { sandbox: 'workspace-write', approvalPolicy: 'on-request' } : {}) });
  }
  upstream.on('open', () => {
    upstreamReady = !remotePeer;
    if (!remotePeer) safeSend(JSON.stringify({ type: 'ready' }));
  });
  upstream.on('message', (data, binary) => {
    if (binary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (remotePeer && msg.type === 'ready') upstreamReady = true;
    if (Number.isSafeInteger(msg.id) && typeof msg.method === 'string' &&
      ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(msg.method)) {
      pendingApprovals.add(msg.id);
    }
    if (typeof msg.id === 'number' && pendingInternal.has(msg.id)) {
      const pending = pendingInternal.get(msg.id);
      clearTimeout(pending.timer); pendingInternal.delete(msg.id);
      if (msg.error) pending.rejectPromise(Error('NATIVE_RPC_FAILED'));
      else pending.resolvePromise(msg.result);
      return;
    }
    safeSend(data);
  });
  browser.on('message', (data, binary) => {
    if (binary || data.length > 128 * 1024) { browser.close(1008); return; }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { browser.close(1008); return; }
    if (Number.isSafeInteger(msg?.id) && pendingApprovals.has(msg.id) &&
      Object.keys(msg).every((key) => ['id', 'result'].includes(key)) &&
      ['accept', 'decline'].includes(msg.result?.decision) &&
      Object.keys(msg.result).length === 1) {
      pendingApprovals.delete(msg.id);
      if (upstreamReady) upstream.send(data.toString(), { binary: false });
      return;
    }
    if (!allowedFrame(msg)) {
      if (Number.isSafeInteger(msg?.id)) safeSend(JSON.stringify({ id: msg.id, error: { code: -32602, message: 'RPC_NOT_ALLOWED' } }));
      else browser.close(1008);
      return;
    }
    if (!upstreamReady) { safeSend(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'HOST_OFFLINE' } })); return; }
    if (msg.method === 'web/start' && !remotePeer) {
      void prepareStart(msg).then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'THREAD_START_UNCONFIRMED' } })));
    } else upstream.send(data.toString(), { binary: false });
  });
  const close = () => {
    upstreamReady = false;
    for (const pending of pendingInternal.values()) { clearTimeout(pending.timer); pending.rejectPromise(Error('DISCONNECTED')); }
    pendingInternal.clear();
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  };
  browser.on('close', close);
  upstream.on('close', () => { upstreamReady = false; if (browser.readyState === WebSocket.OPEN) browser.close(1011, 'host disconnected'); });
  upstream.on('error', () => { upstreamReady = false; if (browser.readyState === WebSocket.OPEN) browser.close(1011, 'host offline'); });
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (currentConnections >= 12) { reject(socket, 429); return; }
  if (coordinator) {
    if (url.pathname !== '/api/connect' || !browserAuthorized(req) ||
        req.headers.origin !== config.origin ||
        !['6v', 'noha'].includes(url.searchParams.get('host'))) { reject(socket); return; }
  } else if (url.pathname !== '/peer' || !privatePeerAuthorized(req)) { reject(socket); return; }
  wss.handleUpgrade(req, socket, head, (client) => {
    currentConnections++;
    client.once('close', () => { currentConnections--; });
    if (coordinator && url.searchParams.get('host') === 'noha') {
      attachRelay(client, config.peerUrl, { Authorization: 'Bearer ' + credential });
    } else attachRelay(client, 'ws://127.0.0.1:45891');
  });
});

server.listen(port, '127.0.0.1', () => { console.log('Web bridge mode=' + mode + ' listening on loopback port ' + port); });
