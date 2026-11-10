// Initialize a host-local, gitignored gateway .env without revealing secrets.
'use strict';
const { randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const url = new URL(process.argv[2] ?? '');
if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') ||
    url.port !== '8443' || url.pathname !== '/' || url.search || url.hash ||
    url.username || url.password) {
  throw new Error('Expected an HTTPS Tailscale Funnel hostname on port 8443');
}
const target = resolve(__dirname, '..', '.env');
if (existsSync(target)) {
  const existing = readFileSync(target, 'utf8').match(/^MOBILE_APPROVAL_SECRET=(.*)$/m)?.[1]?.trim() ?? '';
  // Replace only an insecure placeholder; never rotate a real secret.
  if (existing && !/^(?:0+|replace-.*)$/.test(existing)) {
    throw new Error('Private gateway configuration exists; refusing to overwrite.');
  }
}
const secret = randomBytes(32).toString('hex');
if (!/^[0-9a-f]{64}$/.test(secret) || /^0+$/.test(secret)) {
  throw new Error('Cryptographically secure random generation failed');
}
const text = [
  'MOBILE_PUBLIC_ORIGIN=' + url.origin,
  'MOBILE_APPROVAL_SECRET=' + secret,
  'MOBILE_REDIRECT_URI=codexmobileui://oauth',
  'MOBILE_GATEWAY_PORT=48888',
  'CODEX_APP_SERVER_WS=ws://127.0.0.1:45891',
  '',
].join('\n');
writeFileSync(target, text, { mode: 0o600 });
console.log('Private gateway configuration initialized with 256-bit random secret.');
