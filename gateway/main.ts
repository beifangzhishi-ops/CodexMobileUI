import http from 'node:http';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { createHttpHandler } from './http.js';
import { OAuthStore } from './oauth.js';
import { permitMobileRpcFrame } from './rpcPolicy.js';

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
  const server = http.createServer(createHttpHandler(oauth, config.publicOrigin));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== '/connect') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (client) => {
      let upstream: WebSocket | undefined;
      let accessToken = '';
      let accepted = false;
      const authTimer = setTimeout(() => client.close(4001, 'auth timeout'), 10_000);
      const expiryPoll = setInterval(() => {
        if (accepted && !oauth.verify(accessToken)) client.close(4001, 'token expired');
      }, 30_000);
      client.on('message', (bytes, binary) => {
        if (!accepted) {
          if (binary) { client.close(4001, 'invalid authentication'); return; }
          let credentials: { type?: string; accessToken?: string } = {};
          try { credentials = JSON.parse(bytes.toString()) as typeof credentials; }
          catch { client.close(4001, 'invalid authentication'); return; }
          if (credentials.type !== 'authenticate' || !oauth.verify(credentials.accessToken ?? '')) {
            client.close(4001, 'unauthorized');
            return;
          }
          accepted = true;
          accessToken = credentials.accessToken ?? '';
          clearTimeout(authTimer);
          upstream = new WebSocket(config.upstream, { perMessageDeflate: false });
          upstream.once('open', () => {
            if (client.readyState !== WebSocket.OPEN) return;
            client.send(JSON.stringify({ type: 'ready' }));
          });
          upstream.on('message', (message, isBinary) => {
            if (client.readyState === WebSocket.OPEN) client.send(message, { binary: isBinary });
          });
          upstream.on('close', () => client.close(1011, 'upstream closed'));
          upstream.on('error', () => client.close(1011, 'upstream unavailable'));
          return;
        }
        if (!oauth.verify(accessToken)) {
          client.close(4001, 'token expired');
          return;
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
      client.on('close', () => {
        clearTimeout(authTimer);
        clearInterval(expiryPoll);
        if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.close();
      });
      client.on('error', () => upstream?.terminate());
    });
  });

  return {
    listen: () => new Promise<void>((accept, reject) => {
      server.once('error', reject);
      server.listen(config.listenPort, '127.0.0.1', () => accept());
    }),
    close: () => new Promise<void>((done) => {
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
