import http, { type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';
import { createHttpHandler } from './http.js';
import { OAuthStore } from './oauth.js';
import { permitMobileRpcFrame } from './rpcPolicy.js';
import { ApprovalBridge } from './approvalBridge.js';
import { settingsFromNativeDefault, verifyNativePermissionApplied } from './nativePermission.js';
import { validateWorkspaceMetadata, workspacePath } from './workspace.js';
import { listProjectDirectories, resolveProjectDirectory } from './projectDirectories.js';
import { attachmentFailureMessage, createAttachmentUploader } from './attachments.js';
import { PublicationStore } from './publications.js';
import { redactNativeDiffFrame } from './redactDiff.js';
import { HostFileError, readHostFile, writeHostFile } from './hostFiles.js';
import { SchedulerService } from './schedulerService.js';
import { QuotaGuardService } from './quotaGuardService.js';
import { SidebarPinsStore } from './sidebarPins.js';
import { readNativeToolImage, type VerifiedToolImage } from './toolImages.js';
import { readVisualize } from './visualize.js';
import {
  classifyGatewayClient, classifyGatewayRoute, createGatewayJournal,
  type GatewayTrace,
} from './diagnostics.js';
import { quotaGuardGuardedMethod } from '../shared/quotaGuard.js';

interface Config {
  publicOrigin: string;
  upstream: string;
  secret: string;
  redirectUri: string;
  listenPort: number;
  /** Production uses this listener exclusively; the public listener remains closed. */
  privatePort?: number;
  privateManifestFile?: string;
  stateFile: string;
}

function configuration(): Config {
  const secret = process.env.MOBILE_APPROVAL_SECRET ?? '';
  // The previous Funnel origin is intentionally ignored in private mode.
  const publicOrigin = 'https://unused.invalid';
  const upstream = process.env.CODEX_APP_SERVER_WS ?? 'ws://127.0.0.1:45891';
  if (upstream !== 'ws://127.0.0.1:45891') {
    throw new Error('MobileUI Gateway requires its dedicated local App Server');
  }
  if (!/^https:\/\//.test(publicOrigin)) throw new Error('MOBILE_PUBLIC_ORIGIN 必须是 Funnel HTTPS Origin');
  const u = new URL(upstream);
  if (u.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) {
    throw new Error('上游 Codex App Server 仅允许本机 WS');
  }
  return {
    publicOrigin,
    upstream, secret,
    redirectUri: process.env.MOBILE_REDIRECT_URI ?? 'codexmobileui://oauth',
    listenPort: Number(process.env.MOBILE_GATEWAY_PORT ?? '48888'),
    privatePort: Number(process.env.MOBILE_PRIVATE_GATEWAY_PORT ?? '48889'),
    stateFile: resolve('.state', 'oauth.json'),
  };
}

export function createGateway(config: Config) {
  // Production's private listener never opens the retired OAuth token store.
  // The isolated legacy server is retained only for existing protocol tests.
  const oauth = config.privatePort === undefined
    ? new OAuthStore(config.secret, config.redirectUri, config.stateFile) : null;
  const publications = new PublicationStore(config.stateFile);
  const sidebarPins = new SidebarPinsStore(dirname(config.stateFile));
  const journal = createGatewayJournal(resolve(dirname(config.stateFile), 'mobile-gateway-requests.jsonl'));
  const server = http.createServer(oauth
    ? createHttpHandler(oauth, config.publicOrigin, (event) => {
      console.warn('[mobile-oauth] ' + new Date().toISOString() + ' ' + event);
    }, journal.append)
    : (_req, res) => { res.writeHead(404); res.end(); });
  const loadPrivateMachines = (): { name: string; url: string }[] => {
    const entries: unknown = JSON.parse(readFileSync(resolve(
      config.privateManifestFile ?? '.state/mobile-tailnet-hosts.json'), 'utf8'));
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 16 ||
        !entries.every((entry) => entry && typeof entry === 'object' &&
          typeof entry.name === 'string' && /^[\w-]{1,32}$/.test(entry.name) &&
          typeof entry.url === 'string' &&
          /^http:\/\/100\.\d{1,3}\.\d{1,3}\.\d{1,3}:48889$/.test(entry.url)) ||
        new Set(entries.map((entry) => entry.name)).size !== entries.length) {
      throw new Error('Invalid Tailnet machine manifest');
    }
    return entries;
  };
  const privateHosts = (): Set<string> => new Set([
    '127.0.0.1:48889',
    ...loadPrivateMachines().map((entry) => new URL(entry.url).host),
  ]);
  // Bind the mobile port only to loopback and the actual Tailscale adapter.
  // A wildcard listener would inadvertently expose this unauthenticated
  // private protocol on LAN/public interfaces.
  const localTailnetAddress = (): string => {
    const configured = new Set(loadPrivateMachines().map((entry) => new URL(entry.url).hostname));
    const addresses = Object.entries(networkInterfaces())
      .filter(([name]) => /tailscale/i.test(name))
      .flatMap(([, adapters]) => adapters ?? [])
      .filter((adapter) => adapter.family === 'IPv4' && !adapter.internal &&
        configured.has(adapter.address))
      .map((adapter) => adapter.address);
    if (addresses.length !== 1) throw new Error('Expected one configured local Tailscale IPv4 adapter');
    return addresses[0];
  };
  let quotaHostId: '6v' | 'noha' = '6v';
  if (config.privatePort === 48889) {
    try {
      const localAddress = localTailnetAddress();
      quotaHostId = loadPrivateMachines().find((entry) =>
        new URL(entry.url).hostname === localAddress)?.name === 'noha' ? 'noha' : '6v';
    } catch { /* The host manifest is already required by the private listener. */ }
  }
  const quotaGuard = config.privatePort === undefined ? null
    : new QuotaGuardService(dirname(config.stateFile), config.upstream, quotaHostId);
  const scheduler = new SchedulerService(config.stateFile, config.upstream, quotaGuard);
  // Never route this listener through Funnel: membership in the Tailnet is its
  // entire access boundary. It does not serve OAuth or public Gateway routes.
  const privateServer = http.createServer((req, res) => {
    let allowedHost = false;
    try { allowedHost = privateHosts().has(req.headers.host ?? ''); }
    catch { /* Invalid discovery configuration denies all private requests. */ }
    if (!allowedHost) {
      res.writeHead(403, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok', mode: 'tailnet' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/hosts') {
      try {
        const entries = loadPrivateMachines();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ hosts: entries.map((entry) => ({
          id: entry.name, name: entry.name, url: 'http://' + req.headers.host,
        })) }));
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'HOST_DISCOVERY_UNAVAILABLE' }));
      }
      return;
    }
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end();
  });
  // The same handler serves the two explicitly bound interfaces.
  const tailnetServer = http.createServer((req, res) => privateServer.emit('request', req, res));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  let wsSequence = 0;
  const handleUpgrade = (privateConnection: boolean) =>
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const requestId = ++wsSequence;
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const clientType = classifyGatewayClient(
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    );
    const fields = {
      requestId, route: classifyGatewayRoute(req.url ?? '/'),
      method: 'OTHER' as const, client: clientType,
    };
    const logWs = (event: GatewayTrace['event'], extra: Partial<GatewayTrace> = {}) => {
      journal.append({ event, ...fields, ...extra });
    };
    logWs('ws.received');
    if (path !== '/connect') {
      logWs('ws.rejected');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      logWs('ws.upgraded');
      let upstream: WebSocket | undefined;
      const approvalBridge = new ApprovalBridge();
      const attachmentUploader = createAttachmentUploader();
      const verifiedToolImages = new Map<string, VerifiedToolImage>();
      let nextInternalId = 1_000_000_000;
      const internalRequests = new Map<number, {
        resolve: (result: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }>();
      // Trace only fixed lifecycle method names and numeric request sequence IDs.
      // Never journal the thread ID, request parameters, response or error text.
      const tracedMethods = new Set(['thread/delete', 'thread/archive', 'thread/unarchive']);
      const tracedNotices = new Set(['thread/deleted', 'thread/archived', 'thread/unarchived']);
      const tracedRequests = new Map<number, {
        method: 'thread/delete' | 'thread/archive' | 'thread/unarchive';
        startedAt: number;
        slowTimer: ReturnType<typeof setTimeout>;
      }>();
      const finishTrace = (id: number, outcome: 'success' | 'error' | 'disconnect' | 'send_failed') => {
        const pending = tracedRequests.get(id);
        if (!pending) return;
        clearTimeout(pending.slowTimer);
        tracedRequests.delete(id);
        logWs(outcome === 'disconnect' ? 'rpc.abandoned'
          : outcome === 'send_failed' ? 'rpc.forwardFailed' : 'rpc.completed', {
          rpcMethod: pending.method, rpcRequestId: id, rpcOutcome: outcome,
          elapsedMs: Date.now() - pending.startedAt,
        });
      };
      const abandonTraces = () => {
        for (const id of tracedRequests.keys()) finishTrace(id, 'disconnect');
      };
      const traceRequest = (bytes: { toString(): string }, binary: boolean): number | null => {
        if (binary) return null;
        try {
          const frame = JSON.parse(bytes.toString()) as { id?: unknown; method?: unknown };
          if (!tracedMethods.has(String(frame.method)) ||
              !Number.isSafeInteger(frame.id) || Number(frame.id) < 0 ||
              Number(frame.id) >= 1_000_000_000) return null;
          const id = Number(frame.id);
          const method = frame.method as 'thread/delete' | 'thread/archive' | 'thread/unarchive';
          const startedAt = Date.now();
          const slowTimer = setTimeout(() => {
            if (tracedRequests.has(id)) logWs('rpc.slow', {
              rpcMethod: method, rpcRequestId: id, elapsedMs: Date.now() - startedAt,
            });
          }, 25_000);
          tracedRequests.set(id, { method, startedAt, slowTimer });
          logWs('rpc.forwarded', { rpcMethod: method, rpcRequestId: id });
          return id;
        } catch { return null; }
      };
      const requestInternal = (method: string, params: Record<string, unknown>) =>
        new Promise<unknown>((resolve, reject) => {
          if (upstream?.readyState !== WebSocket.OPEN) {
            reject(new Error('Codex App Server 未连接'));
            return;
          }
          const id = nextInternalId++;
          const timer = setTimeout(() => {
            internalRequests.delete(id);
            reject(new Error('原生目录准备超时'));
          }, 20_000);
          internalRequests.set(id, { resolve, reject, timer });
          upstream.send(JSON.stringify({ id, method, params }), (error) => {
            if (!error) return;
            clearTimeout(timer);
            internalRequests.delete(id);
            reject(new Error('原生目录请求发送失败'));
          });
        });
      const rejectInternal = () => {
        for (const pending of internalRequests.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error('原生目录连接已断开'));
        }
        internalRequests.clear();
      };
      let accessToken = '';
      let accepted = false;
      const authTimer = setTimeout(() => client.close(4001, 'auth timeout'), 10_000);
      const expiryPoll = privateConnection ? null : setInterval(() => {
        if (accepted && !oauth?.verify(accessToken)) client.close(4001, 'token expired');
      }, 30_000);
      client.on('message', (bytes, binary) => {
        if (!accepted) {
          if (binary) {
            logWs('ws.authRejected');
            client.close(4001, 'invalid authentication');
            return;
          }
          let credentials: { type?: string; accessToken?: string } = {};
          try { credentials = JSON.parse(bytes.toString()) as typeof credentials; }
          catch {
            logWs('ws.authRejected');
            client.close(4001, 'invalid authentication');
            return;
          }
          if (credentials.type !== (privateConnection ? 'connect' : 'authenticate') ||
              (!privateConnection && !oauth?.verify(credentials.accessToken ?? ''))) {
            logWs('ws.authRejected');
            client.close(4001, 'unauthorized');
            return;
          }
          accepted = true;
          logWs('ws.authAccepted');
          accessToken = credentials.accessToken ?? '';
          clearTimeout(authTimer);
          upstream = new WebSocket(config.upstream, { perMessageDeflate: false });
          upstream.once('open', () => {
            logWs('ws.upstreamReady');
            if (client.readyState !== WebSocket.OPEN) return;
            client.send(JSON.stringify({ type: 'ready' }));
          });
          upstream.on('message', (message, isBinary) => {
            if (!isBinary) {
              approvalBridge.observeNativeFrame(message.toString());
              try {
                const response = JSON.parse(message.toString()) as {
                  id?: number; result?: unknown; error?: { code?: number; message?: string };
                  method?: string; params?: Record<string, unknown>;
                };
                // A native server request can also carry a numeric id. Only a
                // response (no method) may fulfill our internal RPC; otherwise
                // approvals/elicitation requests can be swallowed on ID overlap.
                const pending = !response.method && typeof response.id === 'number'
                  ? internalRequests.get(response.id) : undefined;
                if (pending) {
                  clearTimeout(pending.timer);
                  internalRequests.delete(response.id!);
                  if (response.error) pending.reject(new Error(
                    /database is locked|SQLITE_BUSY|Error code 5/i.test(response.error.message ?? '')
                      ? 'NATIVE_DATABASE_BUSY' : 'NATIVE_OPERATION_FAILED',
                  ));
                  else pending.resolve(response.result);
                  return;
                }
                if (typeof response.id === 'number' && !('method' in response)) {
                  finishTrace(response.id, response.error ? 'error' : 'success');
                }
                const method = (response as { method?: unknown }).method;
                if (typeof method === 'string' && tracedNotices.has(method)) {
                  logWs('rpc.notification', { rpcMethod: method as
                    'thread/deleted' | 'thread/archived' | 'thread/unarchived' });
                }
              } catch { /* Unrelated upstream notification: forward unchanged. */ }
            }
            if (client.readyState === WebSocket.OPEN) {
              if (isBinary) client.send(message, { binary: true });
              else client.send(redactNativeDiffFrame(message.toString()), { binary: false });
            }
          });
          upstream.on('close', () => {
            abandonTraces();
            rejectInternal();
            client.close(1011, 'upstream closed');
          });
          upstream.on('error', () => {
            logWs('ws.upstreamFailed');
            client.close(1011, 'upstream unavailable');
          });
          return;
        }
        if (!privateConnection && !oauth?.verify(accessToken)) {
          client.close(4001, 'token expired');
          return;
        }
        // Native server-request replies have no method, unlike client RPCs.
        // Require an outstanding callback on this authenticated socket.
        const approvalReply = approvalBridge.consumeMobileReply(bytes.toString(), binary);
        if (approvalReply === 'rejected') {
          client.close(1008, 'invalid approval response');
          return;
        }
        if (approvalReply === 'allowed' || typeof approvalReply === 'object') {
          if (upstream?.readyState === WebSocket.OPEN) {
            upstream.send(approvalReply === 'allowed' ? bytes : approvalReply.forwarded,
              { binary: false }, (error) => {
                if (error) client.close(1011, 'approval transport failed');
              });
          } else {
            client.close(1011, 'approval upstream unavailable');
          }
          return;
        }
        // Owner's shared sidebar state lives only on 6v. This RPC is authenticated
        // by the existing mobile Gateway and never forwards to the App Server.
        if (!binary) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: string; params?: unknown;
            };
            if (request.method === 'sidebar/pins/list' || request.method === 'sidebar/pins/set') {
              const id = request.id;
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000) return;
              const reply = (payload: Record<string, unknown>) => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, ...payload }));
              };
              void (async () => {
                const p = request.params;
                if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('PINS_INVALID_PARAMS');
                const params = p as Record<string, unknown>;
                if (request.method === 'sidebar/pins/list' && Object.keys(params).length === 0)
                  return sidebarPins.list();
                if (request.method === 'sidebar/pins/set' &&
                    Object.keys(params).length === 2 && 'pin' in params && 'pinned' in params)
                  return sidebarPins.set(params.pin, params.pinned);
                throw Error('PINS_INVALID_PARAMS');
              })().then((result) => reply({ result })).catch((error: unknown) => {
                const code = error instanceof Error && [
                  'PINS_INVALID_PARAMS', 'PINS_PRIMARY_UNAVAILABLE', 'PINS_BUSY', 'PINS_LIMIT', 'PINS_STATE_INVALID',
                ].includes(error.message) ? error.message : 'PINS_UNAVAILABLE';
                reply({ error: { code: -32602, message: code } });
              });
              return;
            }
          } catch { /* Unrelated or malformed frames use the existing strict policy. */ }
        }
        // Preview assets must be selected from an existing native item.
        if (!binary) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: string; params?: unknown;
            };
            if (request.method === 'workspace/visualize/read') {
              const id = request.id;
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000) return;
              void readVisualize(request.params, requestInternal)
                .then((result) => {
                  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, result }));
                })
                .catch(() => {
                  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({
                    id, error: { code: -32602, message: 'VISUALIZE_UNAVAILABLE' },
                  }));
                });
              return;
            }
            if (request.method === 'workspace/toolImage/read') {
              const id = request.id;
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000) return;
              void readNativeToolImage(request.params, requestInternal, verifiedToolImages)
                .then((result) => {
                  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, result }));
                })
                .catch(() => {
                  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({
                    id, error: { code: -32602, message: 'TOOL_IMAGE_UNAVAILABLE' },
                  }));
                });
              return;
            }
          } catch { /* The ordinary policy handles invalid frames. */ }
        }
        // Host-verified, immutable assistant deliverables; never accept a file path
        // from the phone. Each link must occur in a native agentMessage item.
        if (!binary) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: unknown; params?: unknown;
            };
            if (request.method === 'workspace/permissionFromConfig') {
              const id = request.id;
              const sendResult = (payload: Record<string, unknown>) => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, ...payload }));
              };
              const params = request.params && typeof request.params === 'object' &&
                !Array.isArray(request.params) ? request.params as Record<string, unknown> : {};
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000 ||
                  Object.keys(params).length !== 1 ||
                  typeof params.threadId !== 'string' ||
                  !/^[0-9a-f-]{36}$/i.test(params.threadId)) {
                if (typeof id === 'number') sendResult({
                  error: { code: -32602, message: 'INVALID_PARAMS' },
                });
                return;
              }
              void (async () => {
                try {
                  const obj = (value: unknown): Record<string, unknown> =>
                    value && typeof value === 'object' && !Array.isArray(value)
                      ? value as Record<string, unknown> : {};
                  const threadId = params.threadId as string;
                  const snapshot = obj(await requestInternal('thread/read',
                    { threadId, includeTurns: true }));
                  const nativeThread = obj(snapshot.thread);
                  if (nativeThread.id !== threadId ||
                      typeof nativeThread.cwd !== 'string' ||
                      !nativeThread.cwd.length) throw new Error('THREAD_NOT_FOUND');
                  const turns = Array.isArray(nativeThread.turns) ? nativeThread.turns : [];
                  const latest = obj(turns[turns.length - 1]);
                  if (['inProgress', 'running', 'in_progress'].includes(String(latest.status))) {
                    throw new Error('THREAD_BUSY');
                  }
                  // The native server already knows the effective config.toml,
                  // project config layers and legacy sandbox rules for this cwd.
                  // Ask it to resolve a fresh ephemeral thread, without any
                  // client permission overrides, then pass its exact settings
                  // back through the native thread/settings/update RPC.
                  const nativeDefault = await requestInternal('thread/start', {
                    cwd: nativeThread.cwd, ephemeral: true,
                  });
                  const resolved = settingsFromNativeDefault(nativeDefault);
                  await requestInternal('thread/settings/update', {
                    threadId, ...resolved.update,
                  });
                  const resume = await requestInternal('thread/resume', { threadId });
                  sendResult({ result: verifyNativePermissionApplied(resume, resolved.expected) });
                } catch (error) {
                  const known = new Set([
                    'THREAD_NOT_FOUND', 'THREAD_BUSY', 'NATIVE_DEFAULT_UNAVAILABLE',
                    'NATIVE_PERMISSION_NOT_CONFIRMED',
                  ]);
                  const message = error instanceof Error && known.has(error.message)
                    ? error.message : 'CUSTOM_PERMISSION_UPDATE_FAILED';
                  sendResult({ error: { code: -32000, message } });
                }
              })();
              return;
            }
          } catch { /* Invalid frames are rejected by the regular policy. */ }
        }
        if (!binary) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: string; params?: unknown;
            };
            if (typeof request.method === 'string' && request.method.startsWith('workspace/publication/')) {
              const id = request.id;
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000) return;
              const reply = (payload: Record<string, unknown>) => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, ...payload }));
              };
              void (async () => {
                try {
                  const p = request.params && typeof request.params === 'object' &&
                    !Array.isArray(request.params) ? request.params as Record<string, unknown> : {};
                  let result: unknown;
                  if (request.method === 'workspace/publication/list' &&
                    Object.keys(p).length === 1 && typeof p.threadId === 'string' &&
                    /^[a-f\d-]{36}$/i.test(p.threadId)) {
                    result = await publications.listForThread(p.threadId);
                  } else if (request.method === 'workspace/publication/publish' &&
                    Object.keys(p).length === 3 && typeof p.threadId === 'string' &&
                    /^[a-f\d-]{36}$/i.test(p.threadId) &&
                    typeof p.itemId === 'string' && /^[\w.:-]{1,200}$/.test(p.itemId) &&
                    Number.isSafeInteger(p.linkIndex) && Number(p.linkIndex) >= 0 &&
                    Number(p.linkIndex) < 20) {
                    const native = await requestInternal('thread/read', {
                      threadId: p.threadId, includeTurns: true,
                    });
                    result = await publications.publishFromThread(
                      p.threadId, p.itemId, Number(p.linkIndex), native,
                    );
                  } else if (request.method === 'workspace/publication/stat' &&
                    Object.keys(p).length === 1 && typeof p.id === 'string') {
                    result = await publications.stat(p.id);
                  } else if (request.method === 'workspace/publication/read' &&
                    Object.keys(p).length === 2 && typeof p.id === 'string' &&
                    Number.isSafeInteger(p.offset)) {
                    result = await publications.read(p.id, p.offset);
                  } else throw new Error('INVALID_PARAMS');
                  reply({ result });
                } catch (error) {
                  const message = error instanceof Error && /^(PUBLICATION_[A-Z_]+|INVALID_PARAMS)$/.test(error.message)
                    ? error.message : 'PUBLICATION_REQUEST_FAILED';
                  reply({ error: { code: -32602, message } });
                }
              })();
              return;
            }
          } catch { /* Regular RPC policy rejects unrecognized frames. */ }
        }
        // Authenticated host-local automation RPC; never forward it to Codex.
        if (!binary) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: string; params?: unknown;
            };
            if (typeof request.method === 'string' && request.method.startsWith('automation/')) {
              const id = request.id;
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000) return;
              const reply = (payload: Record<string, unknown>) => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, ...payload }));
              };
              void scheduler.handle(request.method, request.params ?? {}).then((result) => {
                reply({ result });
              }).catch((error: unknown) => {
                const allowed = new Set(['INVALID_PARAMS', 'INVALID_TASK', 'INVALID_SCHEDULE',
                  'INVALID_TIME_ZONE', 'SCHEDULE_IN_PAST', 'TASK_LIMIT', 'TASK_NOT_FOUND',
                  'TASK_BUSY', 'RUN_NOT_FOUND', 'PROJECT_NOT_FOUND', 'MODEL_NOT_FOUND',
                  'EFFORT_NOT_SUPPORTED', 'THREAD_PROJECT_MISMATCH',
                  'QUOTA_GUARD_BLOCKED', 'QUOTA_GUARD_SYNC_PENDING',
                  'QUOTA_GUARD_MONITOR_UNAVAILABLE', 'QUOTA_GUARD_STATE_INVALID',
                  'QUOTA_GUARD_PEER_BLOCKED', 'QUOTA_GUARD_PEER_PENDING']);
                const name = error instanceof Error && allowed.has(error.message)
                  ? error.message : 'AUTOMATION_UNAVAILABLE';
                reply({ error: { code: -32602, message: name } });
              });
              return;
            }
          } catch { /* Malformed JSON is rejected by the existing RPC policy. */ }
        }
        // Host-owned Codex instructions/config; the client supplies no filesystem
        // path. Project roots come exclusively from a native project/read result.
        if (!binary) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: string; params?: unknown;
            };
            if (request.method === 'workspace/hostFileRead' ||
                request.method === 'workspace/hostFileWrite') {
              const id = request.id;
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000) return;
              const reply = (payload: Record<string, unknown>) => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, ...payload }));
              };
              void (async () => {
                try {
                  if (upstream?.readyState !== WebSocket.OPEN) {
                    throw new HostFileError('UNAVAILABLE', '电脑 App Server 未连接');
                  }
                  const context = { readProject: (projectId: string) =>
                    requestInternal('project/read', { projectId }) };
                  const result = request.method === 'workspace/hostFileRead'
                    ? await readHostFile(request.params, context)
                    : await writeHostFile(request.params, context);
                  reply({ result });
                } catch (error) {
                  const safe = error instanceof HostFileError ? error
                    : new HostFileError('UNAVAILABLE', '电脑上的规则或配置文件无法访问');
                  reply({ error: { code: safe.code === 'CONFLICT' ? 409 : -32602,
                    message: safe.message } });
                }
              })();
              return;
            }
          } catch { /* Malformed JSON falls through to the strict RPC allowlist. */ }
        }
        if (!binary) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: string; params?: unknown;
            };
            if (typeof request.method === 'string' && request.method.startsWith('workspace/attachment')) {
              const id = request.id;
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000 ||
                  !request.params || typeof request.params !== 'object' ||
                  Array.isArray(request.params) ||
                  !['workspace/attachmentStart', 'workspace/attachmentChunk',
                    'workspace/attachmentFinish', 'workspace/attachmentCancel',
                    'workspace/attachmentRead'].includes(request.method)) {
                if (typeof id === 'number' && client.readyState === WebSocket.OPEN) client.send(JSON.stringify({
                  id, error: { code: -32602, message: '附件请求格式无效' },
                }));
                return;
              }
              void attachmentUploader.handle(request.method, request.params as Record<string, unknown>)
                .then((result) => {
                  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, result }));
                }).catch((error: unknown) => {
                  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({
                    id, error: { code: -32602, message: attachmentFailureMessage(error) },
                  }));
                });
              return;
            }
          } catch { /* Unsupported frames are rejected by the regular policy gate. */ }
        }
        // Directory selection is restricted to host-approved local roots. Never
        // forward a client-selected absolute path directly to the native RPC.
        if (!binary) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: string; params?: Record<string, unknown>;
            };
            if (request.method === 'workspace/projectDirectories' ||
                request.method === 'workspace/projectCreate') {
              const id = request.id;
              const reply = (payload: Record<string, unknown>) => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, ...payload }));
              };
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000 ||
                  !request.params || typeof request.params !== 'object' ||
                  Array.isArray(request.params)) {
                if (typeof id === 'number') reply({
                  error: { code: -32602, message: 'Invalid project request' },
                });
                return;
              }
              void (async () => {
                try {
                  const params = request.params!;
                  const keys = Object.keys(params);
                  if (request.method === 'workspace/projectDirectories') {
                    if (keys.some((key) => key !== 'locator')) throw new Error('INVALID_PARAMS');
                    reply({ result: await listProjectDirectories(params.locator) });
                    return;
                  }
                  if (keys.length !== 3 || keys.some((key) =>
                      !['name', 'locator', 'idempotencyKey'].includes(key)) ||
                      typeof params.name !== 'string' || !params.name.trim() ||
                      Array.from(params.name).length > 80 || /[\x00-\x1f]/.test(params.name) ||
                      typeof params.idempotencyKey !== 'string' ||
                      !/^\d{13}-[a-f0-9]{16,40}$/.test(params.idempotencyKey)) {
                    throw new Error('INVALID_PARAMS');
                  }
                  const path = await resolveProjectDirectory(params.locator);
                  const result = await requestInternal('project/create', {
                    name: params.name.trim(), roots: [{ path }],
                    idempotencyKey: params.idempotencyKey,
                  });
                  reply({ result });
                } catch (error) {
                  const message = error instanceof Error && error.message === 'NATIVE_DATABASE_BUSY'
                    ? '电脑项目数据库繁忙，请先刷新核对，避免重复创建'
                    : error instanceof Error && error.message === 'INVALID_PARAMS'
                      ? '项目名称或目录参数无效'
                      : request.method === 'workspace/projectDirectories'
                        ? '读取电脑目录失败' : '电脑未确认创建结果，请刷新项目列表后核对';
                  reply({ error: { code: -32603, message } });
                }
              })();
              return;
            }
          } catch { /* Invalid JSON falls through to the policy gate. */ }
        }
        // The mobile client never gets to choose a Windows absolute path.
        // This narrowly scoped gateway operation uses native App Server fs RPCs.
        if (!binary) {
          try {
            const operation = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: string; params?: { draftId?: unknown };
            };
            if (operation.method === 'workspace/prepare') {
              const id = operation.id;
              const sendResult = (payload: Record<string, unknown>) => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ id, ...payload }));
              };
              if (!Number.isSafeInteger(id) || Number(id) < 0 || Number(id) >= 1_000_000_000 ||
                  !operation.params || Object.keys(operation.params).length !== 1) {
                if (typeof id === 'number') sendResult({
                  error: { code: -32602, message: 'Invalid workspace request' },
                });
                return;
              }
              void (async () => {
                try {
                  const path = workspacePath(operation.params!.draftId);
                  await requestInternal('fs/createDirectory', { path, recursive: true });
                  const metadata = await requestInternal('fs/getMetadata', { path });
                  if (!validateWorkspaceMetadata(metadata)) throw new Error('工作区目录不可用');
                  sendResult({ result: { cwd: path } });
                } catch {
                  sendResult({ error: { code: -32603, message: '无法准备独立工作区' } });
                }
              })();
              return;
            }
          } catch { /* Regular policy check rejects malformed JSON. */ }
        }
        const frame = permitMobileRpcFrame(bytes.toString(), binary);
        if (!frame.allowed) {
          if (frame.id !== undefined) {
            client.send(JSON.stringify({
              id: frame.id,
              error: { code: -32601, message: 'Method not permitted by mobile gateway' },
            }));
          } else {
            client.close(1008, 'unsupported mobile message');
          }
          return;
        }
        if (!binary && quotaGuard) {
          try {
            const request = JSON.parse(bytes.toString()) as {
              id?: unknown; method?: unknown;
            };
            const guardedMethod = quotaGuardGuardedMethod(String(request.method));
            if (guardedMethod) {
              const admission = quotaGuard.admission();
              if (!admission.allowed && Number.isSafeInteger(request.id)) {
                client.send(JSON.stringify({ id: request.id, error: { code: -32000,
                  message: admission.reason ?? 'QUOTA_GUARD_BLOCKED' } }));
                return;
              }
            }
          } catch { /* The policy gate already accepted a valid JSON frame. */ }
        }
        // rpcPolicy returns a canonical frame only after validating an attached
        // side-chat request and inserting the fixed trusted instructions.
        const forwarded = frame.forwarded ?? bytes;
        const traceId = traceRequest(bytes, binary);
        if (upstream?.readyState === WebSocket.OPEN) {
          upstream.send(forwarded, { binary }, (error) => {
            if (error && traceId !== null) finishTrace(traceId, 'send_failed');
          });
        } else if (traceId !== null) finishTrace(traceId, 'send_failed');
      });
      client.on('close', (closeCode) => {
        logWs('ws.closed', { closeCode });
        attachmentUploader.dispose();
        abandonTraces();
        clearTimeout(authTimer);
        if (expiryPoll) clearInterval(expiryPoll);
        rejectInternal();
        if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.close();
      });
      client.on('error', () => upstream?.terminate());
    });
  };
  server.on('upgrade', handleUpgrade(false));
  const handlePrivateUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let allowedHost = false;
    try { allowedHost = privateHosts().has(req.headers.host ?? ''); }
    catch { /* Fail closed if the private host manifest is unavailable. */ }
    if (!allowedHost ||
        (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host)) {
      socket.destroy();
      return;
    }
    let target: string;
    let targetMachine: string;
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/connect' || url.searchParams.size !== 1) throw Error('BAD_ROUTE');
      const machine = loadPrivateMachines().find((entry) => entry.name === url.searchParams.get('host'));
      if (!machine) throw Error('UNKNOWN_MACHINE');
      target = machine.url;
      targetMachine = machine.name;
    } catch {
      socket.destroy();
      return;
    }
    if (new URL(target).host === req.headers.host) {
      // The local Gateway retains all mobile-specific RPC and file capabilities.
      req.url = '/connect';
      handleUpgrade(true)(req, socket, head);
      return;
    }
    // Same protocol, remote Gateway. Noha and 6v have equal capabilities; the
    // coordinator only relays bytes, never reads or changes native RPC frames.
    wss.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(target.replace(/^http:/, 'ws:') +
        '/connect?host=' + encodeURIComponent(targetMachine), {
        handshakeTimeout: 10_000, perMessageDeflate: false,
      });
      const queued: { payload: Buffer; binary: boolean }[] = [];
      let queuedBytes = 0;
      client.on('message', (payload, binary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(payload, { binary });
        } else if (upstream.readyState === WebSocket.CONNECTING) {
          const bytes = Array.isArray(payload) ? Buffer.concat(payload) :
            payload instanceof ArrayBuffer ? Buffer.from(new Uint8Array(payload)) :
              Buffer.from(payload);
          queuedBytes += bytes.length;
          if (queuedBytes > 2 * 1024 * 1024) client.close(1009, 'queued frames too large');
          else queued.push({ payload: bytes, binary });
        }
      });
      upstream.on('open', () => {
        for (const frame of queued) upstream.send(frame.payload, { binary: frame.binary });
        queued.length = 0;
      });
      upstream.on('message', (data, binary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
      });
      upstream.on('error', () => client.close(1011, 'machine unavailable'));
      upstream.on('close', () => {
        if (client.readyState === WebSocket.OPEN) client.close(1011, 'machine disconnected');
      });
      client.on('close', () => {
        if (upstream.readyState !== WebSocket.CLOSED) upstream.close();
      });
    });
  };
  privateServer.on('upgrade', handlePrivateUpgrade);
  tailnetServer.on('upgrade', handlePrivateUpgrade);

  return {
    listen: async () => {
      const start = (listener: http.Server, port: number) => new Promise<void>((accept, reject) => {
        listener.once('error', reject);
        listener.listen(port, '127.0.0.1', () => {
          listener.off('error', reject);
          accept();
        });
      });
      if (config.privatePort === undefined) await start(server, config.listenPort);
      else {
        await start(privateServer, config.privatePort);
        if (config.privatePort === 48889) {
          try {
            await new Promise<void>((accept, reject) => {
              tailnetServer.once('error', reject);
              tailnetServer.listen(config.privatePort, localTailnetAddress(), () => {
                tailnetServer.off('error', reject);
                accept();
              });
            });
          } catch (error) {
            await new Promise<void>((done) => privateServer.close(() => done()));
            throw error;
          }
        }
      }
      journal.append({ event: 'gateway.started' });
      quotaGuard?.start();
      scheduler.start();
    },
    close: () => new Promise<void>((done) => {
      journal.append({ event: 'gateway.stopped' });
      quotaGuard?.close();
      scheduler.close();
      for (const socket of wss.clients) socket.terminate();
      wss.close(() => {
        if (config.privatePort === undefined) server.close(() => done());
        else {
          const closeLoopback = () => privateServer.close(() => done());
          if (tailnetServer.listening) tailnetServer.close(closeLoopback);
          else closeLoopback();
        }
      });
    }),
    port: () => {
      const address = (config.privatePort === undefined ? server : privateServer).address();
      if (!address || typeof address === 'string') throw new Error('网关尚未启动');
      return address.port;
    },
    privatePort: () => {
      const address = privateServer.address();
      return address && typeof address !== 'string' ? address.port : null;
    },
  };
}

if (process.argv[1] && /[/\\]gateway[/\\]main\.(ts|js)$/.test(process.argv[1])) {
  const config = configuration();
  createGateway(config).listen().then(() => {
    console.log(`CodexMobileUI private gateway listening on ${config.privatePort ?? config.listenPort}`);
  }).catch((error: unknown) => {
    console.error('Gateway startup failed:', error instanceof Error ? error.message : 'unknown');
    process.exitCode = 1;
  });
}
