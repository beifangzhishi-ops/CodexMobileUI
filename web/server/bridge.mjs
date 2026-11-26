import http from 'node:http';
import { createReadStream, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { createImageStore, isValidImageRpc } from './imageStore.mjs';
import { validDocumentUploadRpc, documentUploadGatewayMethod } from './attachmentProtocol.mjs';
import { webContentSecurityPolicy } from './securityPolicy.mjs';
import { resolveSelectedFile, resolveUserTextDetailed, validatePathHosts } from './pathResolver.mjs';
import { PathSettingsStore } from './pathSettings.mjs';
import { PathOverlayStore } from './pathOverlays.mjs';
import { respondLocalIdentity } from './localIdentity.mjs';
import { NotificationFeed, watchNativeCompletions } from './notificationFeed.mjs';
import { validModelIdentifier } from './modelIdentifier.mjs';
import {
  ISOLATED_MARKUP_CSP, parsePublicationRange, streamPublicationRange,
} from './publicationPreview.mjs';
import { VISUALIZE_FRAME_CSP, VISUALIZE_FRAME_VERSION, visualizeFrame } from './visualizeFrame.mjs';

// This file is copied unchanged to noha's host-only bundle for agent mode.
// Neither endpoint ever listens on a non-loopback interface.
const mode = process.argv[2];
if (!['coordinator', 'agent'].includes(mode)) throw Error('Expected coordinator or agent');
const scriptDir = dirname(fileURLToPath(import.meta.url));
process.chdir(mode === 'coordinator' ? resolve(scriptDir, '../..') : resolve(scriptDir, '..'));
const { WebTitleService } =
  await import(pathToFileURL(resolve('dist/gateway/webTitleService.js')).href);
const { QuotaGuardSettingStore, quotaGuardFileAdmission } =
  await import(pathToFileURL(resolve('dist/gateway/quotaGuardState.js')).href);
const { buildQuotaGuardState, parseQuotaGuardRuntime, quotaGuardGuardedMethod } =
  await import(pathToFileURL(resolve('dist/shared/quotaGuard.js')).href);
const {
  handleQuotaGuardPeerSync, parseQuotaGuardPeerSyncRequest, synchronizeQuotaGuardPeer,
} = await import(pathToFileURL(resolve('dist/gateway/quotaGuardPeer.js')).href);
// The browser uses the same native config resolution and strict read-back
// verification as the mobile Gateway; no client-supplied policy or cwd.
const { settingsFromNativeDefault, verifyNativePermissionApplied } =
  await import(pathToFileURL(resolve('dist/gateway/nativePermission.js')).href);
const { listProjectDirectories, resolveProjectDirectory } =
  await import(pathToFileURL(resolve('dist/gateway/projectDirectories.js')).href);
const { createAttachmentUploader } =
  await import(pathToFileURL(resolve('dist/gateway/attachments.js')).href);
const { ScheduleTaskCalls, scheduleTaskTool, listScheduleModelsTool } =
  await import(pathToFileURL(resolve('dist/gateway/scheduleTaskTool.js')).href);
const {
  PUBLICATION_TEXT_PREVIEW_BYTES, isValidPublicationId, safePublicationFileName,
} = await import(pathToFileURL(resolve('dist/shared/publicationProtocol.js')).href);
const { MAX_VISUALIZE_BYTES, validVisualizeSelection } =
  await import(pathToFileURL(resolve('dist/shared/visualizeReferences.js')).href);
const { SidebarPinsStore } = mode === 'coordinator'
  ? await import(pathToFileURL(resolve('dist/gateway/sidebarPins.js')).href)
  : { SidebarPinsStore: null };
const config = JSON.parse(readFileSync(resolve('.state/web-bridge.json'), 'utf8').replace(/^\uFEFF/, ''));
const credential = readFileSync(resolve('.state/web-peer-token'), 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(credential)) throw Error('Missing strong peer credential');
const coordinator = mode === 'coordinator';
const quotaGuardStore = new QuotaGuardSettingStore(resolve('.state'));
const titleService = new WebTitleService(resolve('.state'), coordinator ? '6v' : 'noha');
const sidebarPins = coordinator ? new SidebarPinsStore(resolve('.state')) : null;
const pathSettings = coordinator ? new PathSettingsStore(resolve('.state/file-path-hosts.json')) : null;
const pathOverlays = coordinator ? new PathOverlayStore(resolve('.state/file-path-overlays.json')) : null;
const notificationFeed = coordinator
  ? new NotificationFeed(resolve('.state/mobile-notification-events.json')) : null;
const quotaGuardSubscribers = new Set();
let remoteQuotaGuardRuntime = null;
let remoteQuotaGuardReachable = false;
let remoteQuotaGuardSyncedAt = null;
let quotaGuardSyncPromise = null;
let quotaGuardSyncRequested = false;
let quotaGuardSyncTimer = null;
let lastQuotaGuardStateJson = '';
if (coordinator && (!/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.ts\.net:4190$/.test(config.origin) ||
  config.peerUrl !== 'ws://100.96.30.32:4191/peer')) throw Error('Invalid private IP configuration');
const port = coordinator ? 4190 : 4191;
const automationMethods = new Set([
  'automation/list', 'automation/inbox', 'automation/runs', 'automation/read',
  'automation/create', 'automation/update', 'automation/toggle',
  'automation/delete', 'automation/run',
]);
/**
 * Scheduler is owned by the per-host private Gateway. The Web Bridge must
 * never open a competing SchedulerService / SQLite writer.
 */
async function requestLocalGateway(method, params) {
  const roster = JSON.parse(readFileSync(resolve('.state/mobile-tailnet-hosts.json'), 'utf8'));
  const machine = coordinator ? '6v' : 'noha';
  const entry = Array.isArray(roster) && roster.find((item) => item?.name === machine);
  const target = new URL(entry?.url ?? '');
  const parts = target.hostname.split('.').map(Number);
  if (target.protocol !== 'http:' || target.port !== '48889' ||
      parts.length !== 4 || parts[0] !== 100 || parts[1] < 64 || parts[1] > 127 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw Error('GATEWAY_NOT_CONFIGURED');
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket('ws://' + target.host + '/connect?host=' + machine, {
      handshakeTimeout: 10000, perMessageDeflate: false,
    });
    let settled = false;
    const needsNativeRead = ['workspace/publication/publish', 'workspace/visualize/read'].includes(method);
    let phase = 'connecting';
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      if (error) rejectPromise(error);
      else resolvePromise(result);
    };
    const timer = setTimeout(() => finish(Error('GATEWAY_TIMEOUT')), 45000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'connect' })));
    ws.on('message', (frame, binary) => {
      if (binary) return;
      let data;
      try { data = JSON.parse(String(frame)); } catch { return; }
      if (phase === 'connecting' && data?.type === 'ready') {
        phase = needsNativeRead ? 'initializing' : 'requesting';
        ws.send(JSON.stringify(needsNativeRead
          ? { id: 2, method: 'initialize', params: {
              clientInfo: { name: 'codex_multi_host_web', version: '0.1.0' },
              capabilities: { experimentalApi: true },
            } }
          : { id: 1, method, params }));
      } else if (phase === 'initializing' && data?.id === 2 && !data.method) {
        if (data.error || !data.result) return finish(Error('PUBLICATION_INITIALIZE_FAILED'));
        phase = 'requesting';
        ws.send(JSON.stringify({ method: 'initialized', params: {} }));
        ws.send(JSON.stringify({ id: 1, method, params }));
      } else if (phase === 'requesting' && data?.id === 1 && !data.method) {
        finish(data.error ? Error(data.error.message || 'AUTOMATION_REQUEST_FAILED') : null,
          data.result);
      }
    });
    ws.on('error', () => finish(Error('GATEWAY_UNAVAILABLE')));
    ws.on('close', () => finish(Error('GATEWAY_DISCONNECTED')));
  });
}

function gatewayTarget(hostId) {
  const roster = JSON.parse(readFileSync(resolve('.state/mobile-tailnet-hosts.json'), 'utf8'));
  const entry = Array.isArray(roster) && roster.find((item) => item?.name === hostId);
  const target = new URL(entry?.url ?? '');
  const parts = target.hostname.split('.').map(Number);
  if (target.protocol !== 'http:' || target.port !== '48889' ||
      parts.length !== 4 || parts[0] !== 100 || parts[1] < 64 || parts[1] > 127 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw Error('GATEWAY_NOT_CONFIGURED');
  }
  return target;
}

function openGatewaySession(hostId) {
  const remote = hostId === 'noha';
  const target = remote ? new URL(config.peerUrl) : gatewayTarget(hostId);
  return new Promise((resolvePromise, rejectPromise) => {
    const ws = new WebSocket(remote ? target.href : 'ws://' + target.host + '/connect?host=' + hostId, {
      headers: remote ? { Authorization: 'Bearer ' + credential } : {},
      handshakeTimeout: 10000, perMessageDeflate: false,
    });
    let sequence = 1;
    const pending = new Map();
    let resolved = false;
    let closing = false;
    const fail = (error) => {
      clearTimeout(timer);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
      if (!closing) {
        closing = true;
        ws.close();
      }
      if (!resolved) {
        resolved = true;
        rejectPromise(error);
      }
    };
    const timer = setTimeout(() => fail(Error('GATEWAY_TIMEOUT')), 15000);
    // A Web Agent sends ready once its native socket is open. Only the
    // Gateway transport expects a connect frame before sending ready.
    if (!remote) ws.on('open', () => ws.send(JSON.stringify({ type: 'connect' })));
    ws.on('message', (frame, binary) => {
      if (binary) return;
      let data;
      try { data = JSON.parse(String(frame)); } catch { return; }
      if (!resolved && data?.type === 'ready') {
        resolved = true;
        clearTimeout(timer);
        resolvePromise({
          request(method, params, timeoutMs = 45000, envelope = 'web/publication') {
            return new Promise((resolveRequest, rejectRequest) => {
              const id = sequence++;
              const requestTimeout = setTimeout(() => {
                pending.delete(id);
                rejectRequest(Error('GATEWAY_TIMEOUT'));
              }, timeoutMs);
              pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer: requestTimeout });
              ws.send(JSON.stringify(remote
                ? envelope === 'web/quotaGuard'
                  ? { id, method: 'web/quotaGuard', params }
                  : { id, method: 'web/publication', params: { method, params } }
                : { id, method, params }));
            });
          },
          close() {
            if (!closing) {
              closing = true;
              ws.close();
            }
          },
        });
        return;
      }
      if (!Number.isSafeInteger(data?.id) || data.method || !pending.has(data.id)) return;
      const request = pending.get(data.id);
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (data.error) request.reject(Error(data.error.message || 'GATEWAY_REQUEST_FAILED'));
      else request.resolve(data.result);
    });
    ws.on('error', () => fail(Error('GATEWAY_UNAVAILABLE')));
    ws.on('close', () => fail(Error('GATEWAY_DISCONNECTED')));
  });
}

function currentQuotaGuardState() {
  if (!coordinator) throw Error('QUOTA_GUARD_PRIMARY_UNAVAILABLE');
  const setting = quotaGuardStore.readAuthoritativeSync();
  const localValue = quotaGuardStore.readRuntimeSync('6v');
  const persistedRemote = quotaGuardStore.readPeerRuntimeSync('noha')?.runtime ?? null;
  const remoteValue = persistedRemote ?? (remoteQuotaGuardReachable
    ? parseQuotaGuardRuntime(remoteQuotaGuardRuntime, 'noha') : remoteQuotaGuardRuntime);
  const local = localValue ? { ...localValue, enabled: setting.enabled,
    settingRevision: setting.revision } : null;
  const remote = remoteValue ? { ...remoteValue, enabled: setting.enabled,
    settingRevision: setting.revision } : null;
  return buildQuotaGuardState(setting, !remoteQuotaGuardReachable,
    remoteQuotaGuardReachable ? null : 'noha 离线或尚未确认共享设置',
    remoteQuotaGuardSyncedAt, { '6v': local, noha: remote });
}

function publishQuotaGuardState(state) {
  const serialized = JSON.stringify(state);
  if (serialized === lastQuotaGuardStateJson) return;
  lastQuotaGuardStateJson = serialized;
  const frame = JSON.stringify({ method: 'quotaGuard/updated', params: { state } });
  for (const send of quotaGuardSubscribers) {
    try { send(frame); } catch { /* A disconnected browser is removed by its close handler. */ }
  }
}

async function syncPeerQuotaGuard() {
  if (!coordinator) return;
  quotaGuardSyncRequested = true;
  if (quotaGuardSyncPromise) return quotaGuardSyncPromise;
  quotaGuardSyncPromise = (async () => {
    do {
      quotaGuardSyncRequested = false;
      try {
        const peer = await openGatewaySession('noha');
        try {
          remoteQuotaGuardRuntime = await synchronizeQuotaGuardPeer(
            quotaGuardStore, '6v', 'noha',
            (params, timeoutMs) => peer.request('', params, timeoutMs, 'web/quotaGuard'));
          remoteQuotaGuardReachable = true;
          remoteQuotaGuardSyncedAt = Date.now();
        } finally { peer.close(); }
      } catch {
        remoteQuotaGuardReachable = false;
      }
    } while (quotaGuardSyncRequested);
  })().finally(() => {
    quotaGuardSyncPromise = null;
    try { publishQuotaGuardState(currentQuotaGuardState()); } catch { /* Invalid primary state is reported by the RPC. */ }
    if (quotaGuardSyncTimer) clearTimeout(quotaGuardSyncTimer);
    quotaGuardSyncTimer = setTimeout(() => {
      quotaGuardSyncTimer = null;
      void syncPeerQuotaGuard();
    }, 2_000);
  });
  return quotaGuardSyncPromise;
}

async function requestHostPublication(hostId, method, params, session) {
  if (!['6v', 'noha'].includes(hostId)) throw Error('UNKNOWN_HOST');
  if (session) return session.request(method, params);
  if (hostId === '6v') return requestLocalGateway(method, params);
  const peer = await openGatewaySession('noha');
  try { return await peer.request(method, params); }
  finally { peer.close(); }
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 384 * 1024, perMessageDeflate: false });
const assets = resolve('web/dist');
// Only the coordinator serves browser assets. The private noha agent does not
// configure a public browser origin and must not evaluate browser-only CSP.
const contentSecurityPolicy = coordinator ? webContentSecurityPolicy(config.origin) : null;
const allowedAssets = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'], ['.woff', 'font/woff'], ['.ttf', 'font/ttf'],
]);
let currentConnections = 0;
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function browserAuthorized(req) {
  // The browser has no login. Restrict the HTTP Host to the chosen private
  // Tailscale Serve authority; the Coordinator itself stays on loopback.
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
  if (respondLocalIdentity(req, res, {
    hostId: coordinator ? '6v' : 'noha', port, origin: config.origin ?? 'http://100.76.74.124:4190',
  })) return;
  if (!coordinator || !browserAuthorized(req)) {
    res.writeHead(403); res.end(); return;
  }
  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const name = requestUrl.pathname;
  if (name === '/api/visualize' && req.method === 'GET') {
    const hostId = requestUrl.searchParams.get('host');
    const selection = {
      threadId: requestUrl.searchParams.get('thread'),
      itemId: requestUrl.searchParams.get('item'),
      index: Number(requestUrl.searchParams.get('index')),
    };
    if (!['6v', 'noha'].includes(hostId) || requestUrl.searchParams.size !== 4 ||
        !/^[0-7]$/.test(requestUrl.searchParams.get('index') ?? '') ||
        !validVisualizeSelection(selection)) {
      res.writeHead(400); res.end(); return;
    }
    void (async () => {
      let session;
      res.setHeader('Content-Security-Policy', VISUALIZE_FRAME_CSP);
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      try {
        const known = new RegExp('^"v' + VISUALIZE_FRAME_VERSION + '-([a-f0-9]{64})"$')
          .exec(typeof req.headers['if-none-match'] === 'string' ? req.headers['if-none-match'] : '');
        const params = known ? { ...selection, etag: '"' + known[1] + '"' } : selection;
        if (hostId === 'noha') session = await openGatewaySession(hostId);
        const method = 'workspace/visualize/read';
        const result = await (session ? session.request(method, params) : requestLocalGateway(method, params));
        if (!/^"[a-f0-9]{64}"$/.test(result?.etag)) throw Error('VISUALIZE_UNAVAILABLE');
        const etag = '"v' + VISUALIZE_FRAME_VERSION + '-' + result.etag.slice(1);
        if (known && etag === known[0]) {
          res.writeHead(304, { ETag: etag, 'Cache-Control': 'private, max-age=300' });
          res.end(); return;
        }
        if (typeof result.data !== 'string' || result.data.length > Math.ceil(MAX_VISUALIZE_BYTES / 3) * 4) {
          throw Error('VISUALIZE_UNAVAILABLE');
        }
        const bytes = Buffer.from(result.data, 'base64');
        if (!bytes.length || bytes.length >= MAX_VISUALIZE_BYTES) throw Error('VISUALIZE_UNAVAILABLE');
        const html = visualizeFrame(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        res.writeHead(200, { ETag: etag, 'Cache-Control': 'private, max-age=300' });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end(visualizeFrame('<p role="status">互动组件暂时无法打开。</p>'));
      } finally { session?.close(); }
    })();
    return;
  }
  if (name === '/api/publication' && ['GET', 'HEAD'].includes(req.method ?? '')) {
    void (async () => {
      const hostId = requestUrl.searchParams.get('host');
      const id = requestUrl.searchParams.get('id');
      const mode = requestUrl.searchParams.get('mode') ?? 'download';
      if (!['6v', 'noha'].includes(hostId ?? '') || !isValidPublicationId(id) ||
          !['download', 'preview'].includes(mode) || requestUrl.searchParams.size !== 3) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Invalid publication request');
        return;
      }
      let session;
      try {
        session = await openGatewaySession(hostId);
        const file = await session.request('workspace/publication/stat', { id }, 45000);
        if (!file || file.status !== 'ready' || !Number.isSafeInteger(file.size) || file.size < 1 ||
            typeof file.name !== 'string') throw Error('PUBLICATION_UNAVAILABLE');
        const preview = mode === 'preview';
        const kind = preview ? file.previewKind : null;
        if (preview && !kind) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('No inline preview is available for this file');
          return;
        }
        const textPreview = preview && (kind === 'text' || kind === 'markdown');
        let range = parsePublicationRange(req.headers.range, file.size);
        if (range === false) {
          res.writeHead(416, {
            'Content-Range': `bytes */${file.size}`,
            'Accept-Ranges': 'bytes',
          });
          res.end();
          return;
        }
        if (textPreview) {
          const start = range?.start ?? 0;
          const end = Math.min(range?.end ?? file.size - 1, start + PUBLICATION_TEXT_PREVIEW_BYTES - 1);
          range = req.headers.range || end + 1 < file.size ? { start, end } : null;
        }
        const start = range?.start ?? 0;
        const end = range?.end ?? file.size - 1;
        const length = end - start + 1;
        const mime = preview && (textPreview || kind === 'text')
          ? 'text/plain; charset=utf-8'
          : /^[\w.+-]+\/[\w.+-]+$/.test(String(file.mime ?? ''))
            ? file.mime : 'application/octet-stream';
        const filename = safePublicationFileName(file.name);
        const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/[%\\"]/g, '_');
        res.statusCode = range ? 206 : 200;
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Length', length);
        if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
        res.setHeader('Content-Disposition', preview
          ? `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
          : `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
        if (textPreview && end + 1 < file.size) {
          res.setHeader('X-Codex-Preview-Truncated', 'true');
        }
        if (preview && kind === 'markup') {
          res.setHeader('Content-Security-Policy', ISOLATED_MARKUP_CSP);
        }
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        await streamPublicationRange(session, id, start, end, res);
        res.end();
      } catch {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Publication unavailable or expired');
        } else if (!res.writableEnded) res.destroy();
      } finally {
        session?.close();
      }
    })();
    return;
  }
  if (name === '/api/sidebar-pins' && (req.method === 'GET' || req.method === 'POST')) {
    const reply = (status, result) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    };
    void (async () => {
      if (req.method === 'GET') return sidebarPins.list();
      if (req.headers.origin !== config.origin ||
          !String(req.headers['content-type'] ?? '').startsWith('application/json'))
        throw Error('INVALID_REQUEST');
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString('utf8');
        if (raw.length > 2048) throw Error('INVALID_REQUEST');
      }
      const body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length !== 2 || !('pin' in body) || !('pinned' in body))
        throw Error('INVALID_REQUEST');
      return sidebarPins.set(body.pin, body.pinned);
    })().then((result) => reply(200, result)).catch(() => reply(400, { error: 'PINS_REQUEST_FAILED' }));
    return;
  }
  if (name === '/api/file-path-hosts' && (req.method === 'GET' || req.method === 'POST')) {
    const reply = (status, result) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    };
    void (async () => {
      if (req.method === 'GET') return pathSettings.read();
      if (req.headers.origin !== config.origin ||
          !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        throw Error('INVALID_REQUEST');
      }
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString('utf8');
        if (raw.length > 512) throw Error('INVALID_REQUEST');
      }
      return pathSettings.save(JSON.parse(raw));
    })().then((result) => reply(200, result))
      .catch(() => reply(400, { error: 'PATH_HOSTS_REQUEST_FAILED' }));
    return;
  }
  if (name === '/api/file-path-overlays' && (req.method === 'GET' || req.method === 'POST')) {
    const reply = (status, result) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    };
    void (async () => {
      if (req.method === 'GET') {
        const query = new URL(req.url, config.origin);
        return pathOverlays.read(query.searchParams.get('host'),
          query.searchParams.get('thread'));
      }
      if (req.headers.origin !== config.origin ||
          !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        throw Error('INVALID_REQUEST');
      }
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString('utf8');
        if (raw.length > 20000) throw Error('INVALID_REQUEST');
      }
      return pathOverlays.save(JSON.parse(raw));
    })().then((result) => reply(200, result))
      .catch(() => reply(400, { error: 'PATH_OVERLAY_REQUEST_FAILED' }));
    return;
  }
  if (req.method !== 'GET') { res.writeHead(403); res.end(); return; }
  const relative = name === '/' ? '/index.html' : name;
  let decoded;
  try { decoded = decodeURIComponent(relative); } catch { res.writeHead(400); res.end(); return; }
  const target = resolve(assets, '.' + decoded);
  if (!target.startsWith(assets + sep) || !allowedAssets.has(extname(target)) || !existsSync(target)) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', allowedAssets.get(extname(target)));
  res.setHeader('Content-Security-Policy', contentSecurityPolicy);
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
function validTextInput(input, withImages = false) {
  return Array.isArray(input) && input.length >= 1 &&
    input.length <= (withImages ? 13 : 9) && input[0]?.type === 'text' &&
    typeof input[0]?.text === 'string' && (input[0].text.trim().length > 0 || input.length > 1) &&
    input[0].text.length <= 12_000 && subset(input[0], ['type','text']) &&
    input.filter((item) => item?.type === 'localImage').length <= (withImages ? 4 : 0) &&
    input.filter((item) => ['mention', 'skill'].includes(item?.type)).length <= 8 &&
    input.slice(1).every((item) => {
      if (!item || typeof item !== 'object') return false;
      if (item.type === 'localImage') return withImages && subset(item, ['type','path']) &&
        typeof item.path === 'string' && item.path.length > 0 && item.path.length <= 400;
      if (!['mention','skill'].includes(item.type) || !subset(item, ['type','name','path']) ||
        typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 100 ||
        typeof item.path !== 'string' || item.path.length > 4096) return false;
      return item.type === 'mention' ? /^(app|plugin):\/\/[^\s]+$/.test(item.path)
        : /^(?:[A-Za-z]:[\\/]|\/).+[/\\]SKILL\.md$/i.test(item.path);
    });
}
/** Query-only RPCs share one minimal policy instead of per-feature bridge handlers. */
function catalogFrame(method, p) {
  if (!/^(skills|app|plugin)\/(list|installed)$/.test(method)) return false;
  return Object.entries(p).every(([key, value]) => {
    if (key === 'cwds') return Array.isArray(value) && value.length <= 1 &&
      value.every((cwd) => typeof cwd === 'string' && cwd.length <= 4096 &&
        (/^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('/')));
    if (key === 'threadId') return validId(value);
    if (key === 'cursor') return typeof value === 'string' && value.length > 0 && value.length <= 1024;
    if (key === 'limit') return Number.isInteger(value) && value >= 1 && value <= 100;
    return (key === 'forceReload' || key === 'forceRefetch') && typeof value === 'boolean';
  });
}
function validCollaborationMode(mode, model) {
  if (mode === undefined) return true;
  if (!mode || typeof mode !== 'object' || !subset(mode, ['mode','settings']) ||
      !['default','plan'].includes(mode.mode)) return false;
  const settings = mode.settings;
  return settings && typeof settings === 'object' &&
    subset(settings, ['model','reasoning_effort','developer_instructions']) &&
    validModelIdentifier(settings.model) &&
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
  if (msg.method === 'quotaGuard/state') return coordinator && Object.keys(p).length === 0;
  if (msg.method === 'quotaGuard/set') return coordinator &&
    subset(p, ['enabled', 'expectedRevision']) && Object.keys(p).length === 2 &&
    typeof p.enabled === 'boolean' && Number.isSafeInteger(p.expectedRevision) &&
    p.expectedRevision >= 0;
  if (msg.method === 'web/quotaGuard') return !coordinator &&
    parseQuotaGuardPeerSyncRequest(p, '6v') !== null;
  if (msg.method.startsWith('web/image/')) return isValidImageRpc(msg.method, p);
  if (msg.method.startsWith('web/attachment/')) return validDocumentUploadRpc(msg.method, p);
  if (msg.method === 'web/pathResolve') return subset(p, ['text', 'hosts']) &&
    Object.keys(p).length === 2 && typeof p.text === 'string' &&
    p.text.length <= 12000 && p.hosts && typeof p.hosts === 'object' &&
    !Array.isArray(p.hosts) && JSON.stringify(p.hosts).length <= 512 &&
    (() => { try { validatePathHosts(p.hosts); return true; } catch { return false; } })();
  if (msg.method === 'web/pathFile') return subset(p, ['path', 'sourceHost', 'hosts']) &&
    Object.keys(p).length === 3 && typeof p.path === 'string' &&
    p.path.length <= 2048 && ['6v', 'noha'].includes(p.sourceHost) &&
    p.hosts && typeof p.hosts === 'object' && !Array.isArray(p.hosts) &&
    JSON.stringify(p.hosts).length <= 512 &&
    (() => { try { validatePathHosts(p.hosts); return true; } catch { return false; } })();
  if (msg.method === 'web/automation') {
    return subset(p, ['method', 'params']) && Object.keys(p).length === 2 &&
      automationMethods.has(p.method) && p.params && typeof p.params === 'object' &&
      !Array.isArray(p.params) && JSON.stringify(p.params).length <= 32000;
  }
  if (msg.method === 'web/hostFile') {
    if (!subset(p, ['method', 'params']) || Object.keys(p).length !== 2 ||
        !['workspace/hostFileRead', 'workspace/hostFileWrite'].includes(p.method) ||
        !p.params || typeof p.params !== 'object' || Array.isArray(p.params)) return false;
    const f = p.params;
    if (!['globalRules', 'projectRules', 'config'].includes(f.kind) ||
        Object.keys(f).some((key) => ![
          'kind', 'projectId', 'rootIndex', 'text', 'revision', 'filename',
        ].includes(key))) return false;
    if (f.kind === 'projectRules') {
      if (typeof f.projectId !== 'string' || !/^[\w-]{1,128}$/.test(f.projectId) ||
          (f.rootIndex !== undefined && (!Number.isInteger(f.rootIndex) ||
          f.rootIndex < 0 || f.rootIndex > 31))) return false;
    } else if (f.projectId !== undefined || f.rootIndex !== undefined) return false;
    if (p.method === 'workspace/hostFileRead') return subset(f, ['kind','projectId','rootIndex']);
    return typeof f.text === 'string' && Buffer.byteLength(f.text, 'utf8') <= 262144 &&
      !f.text.includes(String.fromCharCode(0)) && typeof f.revision === 'string' &&
      /^(missing|sha256:[a-f0-9]{64})$/.test(f.revision) &&
      ['AGENTS.md', 'AGENTS.override.md', 'config.toml'].includes(f.filename);
  }
  if (msg.method === 'web/publication') {
    if (!subset(p, ['method','params']) || Object.keys(p).length !== 2) return false;
    if (p.method === 'workspace/visualize/read') return !coordinator && validVisualizeSelection(p.params);
    if (!['workspace/publication/list','workspace/publication/publish',
          'workspace/publication/stat','workspace/publication/read'].includes(p.method) ||
        !p.params || typeof p.params !== 'object' || Array.isArray(p.params)) return false;
    const f = p.params;
    if (p.method === 'workspace/publication/list') return subset(f,['threadId']) &&
      typeof f.threadId === 'string' && /^[a-f\d-]{36}$/i.test(f.threadId);
    if (p.method === 'workspace/publication/publish') return subset(f,['threadId','itemId','linkIndex']) &&
      Object.keys(f).length === 3 && typeof f.threadId === 'string' &&
      /^[a-f\d-]{36}$/i.test(f.threadId) &&
      typeof f.itemId === 'string' && /^[\w.:-]{1,200}$/.test(f.itemId) &&
      Number.isSafeInteger(f.linkIndex) && f.linkIndex >= 0 && f.linkIndex < 20;
    if (p.method === 'workspace/publication/stat') return subset(f,['id']) &&
      Object.keys(f).length === 1 && typeof f.id === 'string' && /^[a-f0-9]{64}$/.test(f.id);
    return subset(f,['id','offset']) && Object.keys(f).length === 2 &&
      typeof f.id === 'string' && /^[a-f0-9]{64}$/.test(f.id) &&
      Number.isSafeInteger(f.offset) && f.offset >= 0;
  }
  if (msg.method === 'web/projectDirectories') {
    return subset(p, ['locator']) &&
      (p.locator === undefined || typeof p.locator === 'string' &&
        /^r\d{1,2}(?:\/[\w%.-]+){0,13}$/.test(p.locator) && p.locator.length <= 1600);
  }
  if (msg.method === 'web/projectCreate') {
    return subset(p, ['name', 'locator', 'idempotencyKey']) &&
      Object.keys(p).length === 3 &&
      typeof p.name === 'string' && [...p.name.trim()].length >= 1 &&
      [...p.name].length <= 80 && !/[\x00-\x1f]/.test(p.name) &&
      typeof p.locator === 'string' && /^r\d{1,2}(?:\/[\w%.-]+){0,13}$/.test(p.locator) &&
      p.locator.length <= 1600 &&
      typeof p.idempotencyKey === 'string' &&
      /^\d{13}-[a-f0-9]{16,40}$/.test(p.idempotencyKey);
  }
  if (catalogFrame(msg.method, p)) return true;
  if (msg.method === 'web/start') return subset(p, ['projectId','permissions','approvalsReviewer','model','effort']) &&
    (p.projectId === null || validId(p.projectId)) &&
    (p.model === undefined || validModelIdentifier(p.model)) &&
    (p.effort === undefined || ['minimal','low','medium','high','xhigh','max','ultra'].includes(p.effort)) &&
    (p.effort === undefined || p.model !== undefined) &&
    validPermissions(Object.fromEntries(Object.entries(p).filter(([key]) => ['permissions','approvalsReviewer'].includes(key))));
  if (msg.method === 'initialize') return subset(p, ['clientInfo', 'capabilities']) &&
    p.clientInfo?.name === 'codex_multi_host_web' && p.clientInfo?.version === '0.1.0';
  if (msg.method === 'project/list') return subset(p, ['limit', 'cursor']) &&
    (p.limit === undefined || Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= 100) &&
    (p.cursor === undefined || validId(p.cursor));
  if (msg.method === 'thread/search' || (msg.method === 'thread/list' && p.searchTerm !== undefined)) {
    const keys = ['searchTerm', 'limit', 'cursor', 'archived', 'sortKey', 'sourceKinds'];
    const titlesOnly = msg.method === 'thread/list';
    return subset(p, titlesOnly ? [...keys, 'modelProviders', 'useStateDbOnly'] : keys) &&
      typeof p.searchTerm === 'string' && p.searchTerm.trim().length > 0 &&
      p.searchTerm.length <= 200 && !/[\x00-\x1f\x7f]/.test(p.searchTerm) &&
      Number.isInteger(p.limit) && p.limit >= 1 && p.limit <= 50 &&
      p.archived === false && p.sortKey === 'recency_at' &&
      Array.isArray(p.sourceKinds) && p.sourceKinds.length === 0 &&
      (p.cursor === undefined || validId(p.cursor)) &&
      (!titlesOnly || p.useStateDbOnly === true && Array.isArray(p.modelProviders) && p.modelProviders.length === 0);
  }
  if (msg.method === 'thread/list' && p.attachedToThreadId !== undefined)
    return subset(p, ['attachedToThreadId', 'limit', 'cursor', 'archived', 'sortKey', 'modelProviders', 'useStateDbOnly']) &&
      validId(p.attachedToThreadId) && p.limit === 100 && p.archived === false && p.useStateDbOnly === true &&
      p.sortKey === 'recency_at' && Array.isArray(p.modelProviders) && p.modelProviders.length === 0 &&
      (p.cursor === undefined || validId(p.cursor));
  if (msg.method === 'thread/list') return subset(p, ['limit', 'cursor', 'archived', 'sortKey', 'modelProviders']) &&
    p.limit === 100 && p.sortKey === 'recency_at' && Array.isArray(p.modelProviders) && p.modelProviders.length === 0 &&
    (p.archived === undefined || p.archived === true) && (p.cursor === undefined || validId(p.cursor));
  if (msg.method === 'thread/read') return subset(p, ['threadId', 'includeTurns']) &&
    validId(p.threadId) && p.includeTurns === true;
  if (msg.method === 'thread/resume') return subset(p, ['threadId']) && validId(p.threadId);
  if (msg.method === 'web/permissionFromConfig') return subset(p, ['threadId']) &&
    typeof p.threadId === 'string' && /^[0-9a-f-]{36}$/i.test(p.threadId);
  if (msg.method === 'web/subAgent/read') return subset(p, ['threadId', 'agentThreadId']) &&
    validId(p.threadId) && validId(p.agentThreadId) && p.threadId !== p.agentThreadId;
  if (msg.method === 'thread/compact/start') return subset(p, ['threadId']) && validId(p.threadId);
  if (msg.method === 'thread/fork' && p.attachToSource === true)
    return subset(p, ['threadId', 'attachToSource', 'excludeTurns']) &&
      validId(p.threadId) && p.excludeTurns === true;
  if (msg.method === 'thread/fork') return subset(p, ['threadId','lastTurnId','excludeTurns']) &&
    validId(p.threadId) && validId(p.lastTurnId) && p.excludeTurns === true;
  if (msg.method === 'thread/settings/update') {
    if (!validId(p.threadId)) return false;
    if (p.model !== undefined || p.effort !== undefined) return
      subset(p, ['threadId','model','effort']) && validModelIdentifier(p.model) &&
      (p.effort === undefined || ['minimal','low','medium','high','xhigh','max','ultra'].includes(p.effort));
    return subset(p, ['threadId','permissions','approvalsReviewer']) &&
      typeof p.permissions === 'string' && validPermissions({ permissions: p.permissions, approvalsReviewer: p.approvalsReviewer });
  }
  if (msg.method === 'project/read') return subset(p, ['projectId']) && validId(p.projectId);
  if (msg.method === 'model/list') return subset(p, ['limit', 'cursor']) &&
    (p.limit === undefined || p.limit === 100) && (p.cursor === undefined || validId(p.cursor));
  if (msg.method === 'permissionProfile/list') return Object.keys(p).length === 0;
  if (msg.method === 'account/rateLimits/read') return Object.keys(p).length === 0;
  if (msg.method === 'turn/start') return subset(p, ['threadId','input','model','effort',
    'permissions','approvalsReviewer','collaborationMode']) &&
    validId(p.threadId) && validTextInput(p.input, true) &&
    (p.model === undefined || validModelIdentifier(p.model)) &&
    (p.effort === undefined || ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(p.effort)) &&
    validPermissions(Object.fromEntries(Object.entries(p).filter(([key]) => ['permissions','approvalsReviewer'].includes(key)))) &&
    validCollaborationMode(p.collaborationMode, p.model);
  if (msg.method === 'turn/steer') return subset(p, ['threadId','input','expectedTurnId']) &&
    validId(p.threadId) && validId(p.expectedTurnId) && validTextInput(p.input, true);
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
  if (msg.method === 'thread/delete') return subset(p, ['threadId']) && validId(p.threadId);
  if (msg.method === 'thread/metadata/update') return subset(p, ['threadId','projectId']) &&
    validId(p.threadId) && (p.projectId === '' || validId(p.projectId));
  if (msg.method === 'thread/name/set') return subset(p, ['threadId','name']) &&
    validId(p.threadId) && typeof p.name === 'string' &&
    [...p.name.trim()].length >= 1 && [...p.name.trim()].length <= 80 &&
    !/[\x00-\x1f]/.test(p.name);
  return false;
}

function attachRelay(browser, upstreamUrl, headers = {}) {
  const remotePeer = typeof headers.Authorization === 'string';
  const relayHostId = remotePeer ? null : coordinator ? '6v' : 'noha';
  const upstream = new WebSocket(upstreamUrl, { headers, perMessageDeflate: false, handshakeTimeout: 10000, maxPayload: 16 * 1024 * 1024 });
  let upstreamReady = false;
  const pendingApprovals = new Set();
  const pendingInternal = new Map();
  const createdHere = new Map();
  const firstTurnRequests = new Map();
  let internalId = 1_000_000_000;
  const internalRequest = (method, params, timeoutMs = 15000) => new Promise((resolvePromise, rejectPromise) => {
    if (!upstreamReady) { rejectPromise(Error('HOST_OFFLINE')); return; }
    const id = internalId++;
    const timer = setTimeout(() => { pendingInternal.delete(id); rejectPromise(Error('NATIVE_TIMEOUT')); }, timeoutMs);
    pendingInternal.set(id, { resolvePromise, rejectPromise, timer });
    upstream.send(JSON.stringify({ id, method, params }));
  });
  // On a noha route the Coordinator merely forwards validated frames. The
  // noha Agent validates uploaded-file ownership on its own local connection.
  const scheduleCalls = remotePeer ? null : new ScheduleTaskCalls(internalRequest, requestLocalGateway);
  const interactiveRequests = new Map();
  const interactiveTurns = new Map();
  const images = remotePeer ? null : createImageStore(resolve('.state'), (threadId) =>
    internalRequest('thread/read', { threadId, includeTurns: true }));
  const documents = remotePeer ? null : createAttachmentUploader();
  const safeSend = (frame) => {
    if (browser.readyState === WebSocket.OPEN) browser.send(String(frame), { binary: false });
  };
  if (coordinator && !remotePeer) {
    const sendQuotaGuardState = (frame) => {
      if (browser.readyState === WebSocket.OPEN) browser.send(frame, { binary: false });
    };
    quotaGuardSubscribers.add(sendQuotaGuardState);
    browser.once('close', () => quotaGuardSubscribers.delete(sendQuotaGuardState));
  }
  function titleInput(input) {
    const raw = Array.isArray(input) && typeof input[0]?.text === 'string' ? input[0].text : '';
    const delimiter = '\n\n## My request for Codex:\n\n';
    const visible = raw.startsWith('# Files mentioned by the user:\n\n')
      ? raw.split(delimiter).slice(1).join(delimiter) : raw;
    return /^请查看我附带的图片[。]?$/.test(visible.trim()) ? '' : visible.trim();
  }
  async function verifyModelChoice(model, effort) {
    if (model === undefined) return;
    const listed = await internalRequest('model/list', { limit: 100 });
    const match = listed?.data?.find((item) => item.id === model || item.model === model);
    if (!match) throw Error('MODEL_NOT_AVAILABLE');
    if (effort !== undefined && !match.supportedReasoningEfforts?.some((item) => item.reasoningEffort === effort))
      throw Error('EFFORT_NOT_AVAILABLE');
  }
  async function prepareStart(request) {
    await verifyModelChoice(request.params.model, request.params.effort);
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
    // Omitted permission fields always mean the effective native config.toml,
    // including for a new chat without a named project.
    const started = await internalRequest('thread/start', { cwd,
      ...(projectId ? { projectId, dynamicTools: [scheduleTaskTool, listScheduleModelsTool] } : {}),
      ...(request.params.model ? { model: request.params.model } : {}),
      ...(request.params.effort ? { config: { model_reasoning_effort: request.params.effort } } : {}),
      ...requested });
    if (started?.thread?.id) createdHere.set(started.thread.id, { cwd });
    return started;
  }
  upstream.on('open', () => {
    upstreamReady = !remotePeer;
    if (!remotePeer) safeSend(JSON.stringify({ type: 'ready' }));
  });
  upstream.on('message', (data, binary) => {
    if (binary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (scheduleCalls && msg?.method === 'item/tool/call' &&
        (Number.isSafeInteger(msg.id) || typeof msg.id === 'string') &&
        msg.params?.namespace == null &&
        [scheduleTaskTool.name, listScheduleModelsTool.name].includes(msg.params?.tool)) {
      const { threadId, turnId } = msg.params;
      const result = typeof threadId === 'string' && interactiveTurns.get(turnId) === threadId
        ? scheduleCalls.handle(msg.params)
        : Promise.resolve({ success: false, contentItems: [
          { type: 'inputText', text: 'Scheduling requires a turn started in the interactive MobileUI chat.' },
        ] });
      void result.then((output) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify({ id: msg.id, result: output }));
        }
      });
      return;
    }
    if (scheduleCalls && !msg?.method && interactiveRequests.has(msg?.id)) {
      const threadId = interactiveRequests.get(msg.id);
      interactiveRequests.delete(msg.id);
      if (typeof msg.result?.turn?.id === 'string' && msg.result.turn.status === 'inProgress') {
        interactiveTurns.set(msg.result.turn.id, threadId);
      }
    }
    if (scheduleCalls && msg?.method === 'turn/completed') {
      const turnId = msg.params?.turn?.id;
      interactiveTurns.delete(turnId);
      scheduleCalls.finish(msg.params?.threadId, turnId);
    }
    if (notificationFeed && msg?.method === 'turn/completed') {
      const hostId = remotePeer ? 'noha' : '6v';
      void notificationFeed.observe(hostId, msg.params,
        (host, thread, turnId) => notificationFeed.titleReaders.get(host)?.(host, thread, turnId)
          ?? internalRequest('thread/read', { threadId: thread, includeTurns: true }))
        .catch(() => undefined);
    }
    if (remotePeer && msg.type === 'ready') upstreamReady = true;
    if (Number.isSafeInteger(msg.id) && typeof msg.method === 'string' &&
      ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(msg.method)) {
      pendingApprovals.add(msg.id);
    }
    if (typeof msg.id === 'number' && !msg.method && pendingInternal.has(msg.id)) {
      const pending = pendingInternal.get(msg.id);
      clearTimeout(pending.timer); pendingInternal.delete(msg.id);
      if (msg.error) pending.rejectPromise(Error('NATIVE_RPC_FAILED'));
      else pending.resolvePromise(msg.result);
      return;
    }
    if (typeof msg.id === 'number' && !msg.method && firstTurnRequests.has(msg.id)) {
      const pending = firstTurnRequests.get(msg.id);
      firstTurnRequests.delete(msg.id);
      if (!msg.error && (msg.result?.turn?.id || pending.goal && msg.result)) {
        try { if (pending.message) titleService.enqueue(pending.threadId, pending.cwd, pending.message); }
        catch { /* Title is optional; an accepted turn must remain accepted. */ }
        createdHere.delete(pending.threadId);
      }
    }
    safeSend(data);
  });
  browser.on('message', (data, binary) => {
    if (binary || data.length > 384 * 1024) { browser.close(1008); return; }
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
    if (msg.method === 'quotaGuard/state' || msg.method === 'quotaGuard/set') {
      if (!coordinator || remotePeer) {
        safeSend(JSON.stringify({ id: msg.id, error: { code: -32000,
          message: 'QUOTA_GUARD_PRIMARY_UNAVAILABLE' } }));
        return;
      }
      void (async () => {
        let state;
        if (msg.method === 'quotaGuard/set') {
          await quotaGuardStore.setEnabled(msg.params.enabled, msg.params.expectedRevision);
          await syncPeerQuotaGuard();
        }
        state = currentQuotaGuardState();
        publishQuotaGuardState(state);
        safeSend(JSON.stringify({ id: msg.id, result: { state } }));
      })().catch((error) => {
        const known = new Set(['QUOTA_GUARD_CONFLICT', 'QUOTA_GUARD_BUSY',
          'QUOTA_GUARD_STATE_INVALID', 'QUOTA_GUARD_INVALID_PARAMS']);
        safeSend(JSON.stringify({ id: msg.id, error: { code: -32000,
          message: known.has(error?.message) ? error.message : 'QUOTA_GUARD_UNAVAILABLE' } }));
      });
      return;
    }
    if (msg.method === 'web/quotaGuard') {
      if (coordinator) {
        safeSend(JSON.stringify({ id: msg.id, error: { code: -32000,
          message: 'QUOTA_GUARD_PEER_ONLY' } }));
        return;
      }
      try {
        const result = handleQuotaGuardPeerSync(
          quotaGuardStore, msg.params, '6v', 'noha');
        safeSend(JSON.stringify({ id: msg.id, result }));
      } catch {
        safeSend(JSON.stringify({ id: msg.id, error: { code: -32000,
          message: 'QUOTA_GUARD_SYNC_FAILED' } }));
      }
      return;
    }
    if (!upstreamReady) { safeSend(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'HOST_OFFLINE' } })); return; }
    // Direct relay bypasses the per-host Gateway. Gate every model-work method
    // here too, after upload/path/preparation branches and immediately before
    // the final native send below.
    if (relayHostId && quotaGuardGuardedMethod(msg.method)) {
      const admission = quotaGuardFileAdmission(quotaGuardStore, relayHostId, 135_000);
      if (!admission.allowed) {
        safeSend(JSON.stringify({ id: msg.id, error: { code: -32000,
          message: admission.reason ?? 'QUOTA_GUARD_BLOCKED' } }));
        return;
      }
    }
    if (!remotePeer && msg.method === 'thread/name/set') {
      // A requested manual rename takes precedence even if an independent
      // background title generation is already in flight.
      titleService.cancel(msg.params.threadId);
    }
    if (!remotePeer && (msg.method === 'turn/start' || msg.method === 'thread/goal/set')) {
      const owned = createdHere.get(msg.params.threadId);
      if (owned && msg.method === 'turn/start') {
        const firstMessage = titleInput(msg.params.input);
        firstTurnRequests.set(msg.id, {
          threadId: msg.params.threadId, cwd: owned.cwd, message: firstMessage, goal: false,
        });
      } else if (owned && msg.method === 'thread/goal/set' && msg.params.objective) {
        firstTurnRequests.set(msg.id, {
          threadId: msg.params.threadId, cwd: owned.cwd, message: msg.params.objective, goal: true,
        });
      }
    }
    if (msg.method.startsWith('web/attachment/') && !remotePeer) {
      const method = documentUploadGatewayMethod(msg.method);
      void documents.handle(method, method === 'workspace/attachmentStart'
        ? { ...msg.params, kind: 'file' } : msg.params)
        .then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: {
          code: -32602, message: 'DOCUMENT_UPLOAD_REJECTED',
        } })));
    } else if (msg.method === 'web/pathResolve' && !remotePeer) {
      void resolveUserTextDetailed(msg.params.text, coordinator ? '6v' : 'noha',
        validatePathHosts(msg.params.hosts))
        .then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: {
          code: -32602, message: 'PATH_RESOLVE_FAILED',
        } })));
    } else if (msg.method === 'web/pathFile' && !remotePeer) {
      void resolveSelectedFile(msg.params.path, msg.params.sourceHost,
        coordinator ? '6v' : 'noha', validatePathHosts(msg.params.hosts))
        .then((path) => safeSend(JSON.stringify({ id: msg.id, result: { path } })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, result: { path: null } })));
    } else if (msg.method === 'web/publication') {
      void requestLocalGateway(msg.params.method, msg.params.params)
        .then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch((error) => safeSend(JSON.stringify({ id: msg.id, error: {
          code: -32000, message: error.message || 'PUBLICATION_UNAVAILABLE',
        } })));
    } else if (['web/automation', 'web/hostFile'].includes(msg.method) && !remotePeer) {
      void requestLocalGateway(msg.params.method, msg.params.params)
        .then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch((error) => safeSend(JSON.stringify({ id: msg.id, error: {
          code: -32000, message: error.message || 'AUTOMATION_UNCONFIRMED',
        } })));
    } else if (msg.method === 'web/projectDirectories' && !remotePeer) {
      void listProjectDirectories(msg.params.locator)
        .then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: {
          code: -32602, message: 'PROJECT_DIRECTORIES_UNAVAILABLE',
        } })));
    } else if (msg.method === 'web/projectCreate' && !remotePeer) {
      void (async () => {
        const cwd = await resolveProjectDirectory(msg.params.locator);
        return internalRequest('project/create', {
          name: msg.params.name.trim(), roots: [{ path: cwd }],
          idempotencyKey: msg.params.idempotencyKey,
        });
      })().then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: {
          code: -32000, message: 'PROJECT_CREATE_UNCONFIRMED',
        } })));
    } else if (msg.method.startsWith('web/image/') && !remotePeer) {
      void images.handle(msg.method, msg.params)
        .then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: { code: -32602, message: 'IMAGE_REQUEST_REJECTED' } })));
    } else if ((msg.method === 'turn/start' || msg.method === 'turn/steer') && !remotePeer &&
      msg.params.input.some((item) => item.type === 'localImage' && !images.owns(item.path))) {
      safeSend(JSON.stringify({ id: msg.id, error: { code: -32602, message: 'IMAGE_NOT_UPLOADED_ON_THIS_CONNECTION' } }));
    } else if (msg.method === 'web/subAgent/read' && !remotePeer) {
      void (async () => {
        const { threadId, agentThreadId } = msg.params;
        const parent = (await internalRequest('thread/read', { threadId, includeTurns: true }))?.thread;
        if (parent?.id !== threadId || !parent.turns?.some((turn) => Array.isArray(turn.items) &&
          turn.items.some((item) => item.type === 'subAgentActivity' && item.agentThreadId === agentThreadId))) {
          throw Error('AGENT_NOT_ATTACHED');
        }
        const child = await internalRequest('thread/read', { threadId: agentThreadId, includeTurns: true });
        if (child?.thread?.id !== agentThreadId) throw Error('AGENT_NOT_FOUND');
        return child;
      })().then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'AGENT_NOT_AVAILABLE' } })));
    } else if (msg.method === 'thread/fork' && msg.params.attachToSource === true && !remotePeer) {
      void (async () => {
        const { threadId } = msg.params;
        const parent = (await internalRequest('thread/read', { threadId, includeTurns: false }))?.thread;
        if (parent?.id !== threadId || parent.historyMode !== 'paginated' || parent.ephemeral === true)
          throw Error('SIDE_CHAT_UNAVAILABLE');
        const result = await internalRequest('thread/fork', {
          threadId, attachToSource: true, excludeTurns: true,
        }, 60000);
        if (!result?.thread?.id || result.thread.id === threadId) throw Error('SIDE_CHAT_UNCONFIRMED');
        return result;
      })().then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'SIDE_CHAT_UNCONFIRMED' } })));
    } else if (msg.method === 'web/permissionFromConfig' && !remotePeer) {
      void (async () => {
        const threadId = msg.params.threadId;
        const snapshot = await internalRequest('thread/read', { threadId, includeTurns: true });
        const thread = snapshot?.thread;
        if (thread?.id !== threadId || typeof thread.cwd !== 'string' || !thread.cwd) {
          throw Error('THREAD_NOT_FOUND');
        }
        const turns = Array.isArray(thread.turns) ? thread.turns : [];
        if (['inProgress', 'running', 'in_progress'].includes(String(turns.at(-1)?.status))) {
          throw Error('THREAD_BUSY');
        }
        const resolved = settingsFromNativeDefault(await internalRequest('thread/start', {
          cwd: thread.cwd, ephemeral: true,
        }));
        await internalRequest('thread/settings/update', { threadId, ...resolved.update });
        return verifyNativePermissionApplied(
          await internalRequest('thread/resume', { threadId }), resolved.expected);
      })().then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch((error) => {
          const known = new Set(['THREAD_NOT_FOUND', 'THREAD_BUSY',
            'NATIVE_DEFAULT_UNAVAILABLE', 'NATIVE_PERMISSION_NOT_CONFIRMED']);
          const message = known.has(error?.message) ? error.message : 'CUSTOM_PERMISSION_UPDATE_FAILED';
          safeSend(JSON.stringify({ id: msg.id, error: { code: -32000, message } }));
        });
    } else if (msg.method === 'thread/settings/update' && !remotePeer) {
      const modelChange = msg.params.model !== undefined;
      void (modelChange
        ? verifyModelChoice(msg.params.model, msg.params.effort)
        : internalRequest('permissionProfile/list', {}).then((profiles) => {
          if (!Array.isArray(profiles?.data) || !profiles.data.some((profile) =>
            profile?.id === msg.params.permissions && profile.allowed === true))
            throw Error('PERMISSION_NOT_ALLOWED');
        })).then(() => internalRequest('thread/settings/update', msg.params))
        .then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: { code: -32602,
          message: modelChange ? 'MODEL_UPDATE_REJECTED' : 'PERMISSION_UPDATE_REJECTED' } })));
    } else if (msg.method === 'web/start' && !remotePeer) {
      void prepareStart(msg).then((result) => safeSend(JSON.stringify({ id: msg.id, result })))
        .catch(() => safeSend(JSON.stringify({ id: msg.id, error: { code: -32000, message: 'THREAD_START_UNCONFIRMED' } })));
    } else {
      if (scheduleCalls && msg.method === 'turn/start' && interactiveRequests.size < 128) {
        interactiveRequests.set(msg.id, msg.params.threadId);
      }
      upstream.send(data.toString(), { binary: false });
    }
  });
  const close = () => {
    upstreamReady = false;
    images?.dispose();
    documents?.dispose();
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
    if (!browserAuthorized(req) || req.headers.origin !== config.origin ||
        (url.pathname === '/api/connect'
          ? !['6v', 'noha'].includes(url.searchParams.get('host'))
          : url.pathname !== '/api/notifications')) { reject(socket); return; }
  } else if (url.pathname !== '/peer' || !privatePeerAuthorized(req)) { reject(socket); return; }
  wss.handleUpgrade(req, socket, head, (client) => {
    currentConnections++;
    client.once('close', () => { currentConnections--; });
    if (coordinator && url.pathname === '/api/notifications') {
      notificationFeed.subscribe(client);
      return;
    }
    if (coordinator && url.searchParams.get('host') === 'noha') {
      attachRelay(client, config.peerUrl, { Authorization: 'Bearer ' + credential });
    } else attachRelay(client, 'ws://127.0.0.1:45891');
  });
});

server.listen(port, '127.0.0.1', () => { console.log('Web bridge mode=' + mode + ' listening on loopback port ' + port); });
if (notificationFeed) {
  watchNativeCompletions(notificationFeed, '6v', 'ws://127.0.0.1:45891');
  watchNativeCompletions(notificationFeed, 'noha', config.peerUrl, {
    Authorization: 'Bearer ' + credential,
  });
}
if (coordinator) void syncPeerQuotaGuard();
