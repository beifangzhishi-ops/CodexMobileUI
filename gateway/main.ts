import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createHttpHandler } from './http.js';
import { OAuthStore } from './oauth.js';
import { permitMobileRpcFrame } from './rpcPolicy.js';
import { validateWorkspaceMetadata, workspacePath } from './workspace.js';
import {
  classifyGatewayClient, classifyGatewayRoute, createGatewayJournal,
  type GatewayTrace,
} from './diagnostics.js';

interface Config {
  publicOrigin: string;
  upstream: string;
  secret: string;
  redirectUri: string;
  listenPort: number;
  stateFile: string;
}

function configuration(): Config {
  const secret = process.env.MOBILE_APPROVAL_SECRET ?? '';
  const publicOrigin = process.env.MOBILE_PUBLIC_ORIGIN ?? '';
  const upstream = process.env.CODEX_APP_SERVER_WS ?? 'ws://127.0.0.1:45789';
  if (!/^https:\/\//.test(publicOrigin)) throw new Error('MOBILE_PUBLIC_ORIGIN 必须是 Funnel HTTPS Origin');
  const u = new URL(upstream);
  if (u.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) {
    throw new Error('上游 Codex App Server 仅允许本机 WS');
  }
  return {
    publicOrigin: new URL(publicOrigin).origin,
    upstream, secret,
    redirectUri: process.env.MOBILE_REDIRECT_URI ?? 'codexmobileui://oauth',
    listenPort: Number(process.env.MOBILE_GATEWAY_PORT ?? '48888'),
    stateFile: resolve('.state', 'oauth.json'),
  };
}

export function createGateway(config: Config) {
  const oauth = new OAuthStore(config.secret, config.redirectUri, config.stateFile);
  const journal = createGatewayJournal(resolve(dirname(config.stateFile), 'mobile-gateway-requests.jsonl'));
  const server = http.createServer(createHttpHandler(oauth, config.publicOrigin, (event) => {
    console.warn('[mobile-oauth] ' + new Date().toISOString() + ' ' + event);
  }, journal.append));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  let wsSequence = 0;
  server.on('upgrade', (req, socket, head) => {
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
      let nextInternalId = 1_000_000_000;
      const internalRequests = new Map<number, {
        resolve: (result: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }>();
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
      const expiryPoll = setInterval(() => {
        if (accepted && !oauth.verify(accessToken)) client.close(4001, 'token expired');
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
          if (credentials.type !== 'authenticate' || !oauth.verify(credentials.accessToken ?? '')) {
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
              try {
                const response = JSON.parse(message.toString()) as {
                  id?: number; result?: unknown; error?: { code?: number };
                };
                const pending = typeof response.id === 'number'
                  ? internalRequests.get(response.id) : undefined;
                if (pending) {
                  clearTimeout(pending.timer);
                  internalRequests.delete(response.id!);
                  if (response.error) pending.reject(new Error('原生目录操作失败'));
                  else pending.resolve(response.result);
                  return;
                }
              } catch { /* Unrelated upstream notification: forward unchanged. */ }
            }
            if (client.readyState === WebSocket.OPEN) client.send(message, { binary: isBinary });
          });
          upstream.on('close', () => {
            rejectInternal();
            client.close(1011, 'upstream closed');
          });
          upstream.on('error', () => {
            logWs('ws.upstreamFailed');
            client.close(1011, 'upstream unavailable');
          });
          return;
        }
        if (!oauth.verify(accessToken)) {
          client.close(4001, 'token expired');
          return;
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
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(bytes, { binary });
      });
      client.on('close', (closeCode) => {
        logWs('ws.closed', { closeCode });
        clearTimeout(authTimer);
        clearInterval(expiryPoll);
        rejectInternal();
        if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.close();
      });
      client.on('error', () => upstream?.terminate());
    });
  });

  return {
    listen: () => new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(config.listenPort, '127.0.0.1', () => {
        journal.append({ event: 'gateway.started' });
        accept();
      });
    }),
    close: () => new Promise<void>((done) => {
      journal.append({ event: 'gateway.stopped' });
      for (const socket of wss.clients) socket.terminate();
      wss.close(() => server.close(() => done()));
    }),
    port: () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('网关尚未启动');
      return address.port;
    },
  };
}

if (process.argv[1] && /[/\\]gateway[/\\]main\.(ts|js)$/.test(process.argv[1])) {
  const config = configuration();
  createGateway(config).listen().then(() => {
    console.log(`CodexMobileUI gateway listening on 127.0.0.1:${config.listenPort}`);
  }).catch((error: unknown) => {
    console.error('Gateway startup failed:', error instanceof Error ? error.message : 'unknown');
    process.exitCode = 1;
  });
}
