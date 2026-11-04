// Owner-only read-only public HTTPS/WSS probe. No tokens, secrets, thread IDs,
// message bodies or host-specific paths are ever printed.
'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const local = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
const config = Object.fromEntries(local.split(/\r?\n/)
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const origin = new URL(config.MOBILE_PUBLIC_ORIGIN);
if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.ts.net') ||
    origin.port !== '8443' || origin.pathname !== '/' ||
    !/^[0-9a-f]{64}$/.test(config.MOBILE_APPROVAL_SECRET ?? '')) {
  throw new Error('Invalid private Funnel gateway test configuration');
}

const withTimeout = { signal: AbortSignal.timeout(16000) };
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(24).toString('base64url');
const redirectUri = 'codexmobileui://oauth';
let refreshToken;
let access;

async function checkedFetch(path, options) {
  const response = await fetch(origin.origin + path, { ...withTimeout, ...options });
  if (!response.ok) throw new Error('Public gateway endpoint failed: ' + response.status);
  return response;
}

async function check() {
  const auth = new URLSearchParams({
    response_type: 'code',
    client_id: 'codexmobileui-android',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  const consent = await checkedFetch('/oauth/authorize?' + auth.toString());
  const page = await consent.text();
  if (!page.includes('name="code_challenge"') ||
      !page.includes('name="state"') ||
      !page.includes('action="/oauth/consent"')) {
    throw new Error('OAuth consent page did not preserve the PKCE request');
  }
  const approved = await fetch(origin.origin + '/oauth/consent', {
    ...withTimeout,
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({
      ...Object.fromEntries(auth), approval_secret: config.MOBILE_APPROVAL_SECRET,
    }),
  });
  if (approved.status !== 302) throw new Error('Owner OAuth consent was rejected');
  const callback = new URL(approved.headers.get('location'));
  if (callback.protocol !== 'codexmobileui:' || callback.searchParams.get('state') !== state) {
    throw new Error('OAuth callback URI/state mismatch');
  }
  const code = callback.searchParams.get('code');
  if (!code) throw new Error('OAuth code was missing');
  const exchanged = await checkedFetch('/oauth/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'codexmobileui-android',
      code, code_verifier: verifier, redirect_uri: redirectUri,
    }),
  });
  const tokens = await exchanged.json();
  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
    throw new Error('OAuth exchange returned invalid tokens');
  }
  access = tokens.access_token;
  refreshToken = tokens.refresh_token;
  console.log('public_https_pkce_ok');

  await new Promise((resolve, reject) => {
    const wsUrl = origin.origin.replace(/^https:/, 'wss:') + '/connect';
    const socket = new WebSocket(wsUrl);
    let complete = false;
    const timeout = setTimeout(() => fail(new Error('read-only WSS timed out')), 14000);
    function done() {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      socket.close();
      resolve();
    }
    function fail(error) {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      socket.close();
      reject(error);
    }
    function call(id, method, params) {
      socket.send(JSON.stringify({ id, method, params }));
    }
    socket.addEventListener('open', () =>
      socket.send(JSON.stringify({ type: 'authenticate', accessToken: access })));
    socket.addEventListener('message', (event) => {
      let reply;
      try { reply = JSON.parse(String(event.data)); }
      catch { return fail(new Error('Invalid upstream JSON')); }
      if (reply.type === 'ready') {
        return call(1, 'initialize', {
          clientInfo: { name: 'codexmobileui_readonly_funnel_probe', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        });
      }
      if (reply.id === 1) {
        if (reply.error) return fail(new Error('Native initialize failed'));
        socket.send(JSON.stringify({ method: 'initialized', params: {} }));
        return call(2, 'thread/list', { limit: 1, sortKey: 'recency_at' });
      }
      if (reply.id === 2) {
        if (reply.error || !Array.isArray(reply.result?.data)) {
          return fail(new Error('Native thread/list failed'));
        }
        console.log('authenticated_wss_thread_list_ok');
        const thread = reply.result.data.find((item) => typeof item?.id === 'string');
        if (!thread) return done();
        return call(3, 'thread/read', { threadId: thread.id, includeTurns: true });
      }
      if (reply.id === 3) {
        if (reply.error || !Array.isArray(reply.result?.thread?.turns)) {
          return fail(new Error('Native thread/read failed'));
        }
        console.log('authenticated_wss_thread_read_ok');
        return done();
      }
    });
    socket.addEventListener('error', () => fail(new Error('Public WSS transport failed')));
    socket.addEventListener('close', () => {
      if (!complete) fail(new Error('WSS closed before read-only probe completed'));
    });
  });
}

(async () => {
  try { await check(); }
  catch (error) {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : 'Unknown gateway probe failure');
  } finally {
    if (refreshToken) {
      try {
        const revoked = await fetch(origin.origin + '/oauth/revoke', {
          ...withTimeout,
          method: 'POST',
          body: new URLSearchParams({
            client_id: 'codexmobileui-android',
            token: refreshToken,
          }),
        });
        if (!revoked.ok) throw new Error('OAuth token revocation failed');
      } catch {
        console.error('OAuth probe revocation needs manual review');
        process.exitCode = 1;
      }
    }
  }
})();
