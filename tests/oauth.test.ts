import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AuthorizationError, OAuthStore, PUBLIC_CLIENT_ID } from '../gateway/oauth';

const REDIRECT = 'codexmobileui://oauth';
const SECRET = 'this-is-a-long-enough-private-approval-secret';
const VERIFIER = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';

function setup(now = () => Date.now()) {
  const directory = resolve('.tmp', 'test-' + randomUUID());
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'tokens.json');
  const store = new OAuthStore(SECRET, REDIRECT, file, now);
  const params = new URLSearchParams({
    response_type: 'code', client_id: PUBLIC_CLIENT_ID, redirect_uri: REDIRECT,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(VERIFIER).digest('base64url'),
    state: 'random-state-123456',
  });
  return {
    store, params, file,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test('PKCE S256 authorization code is one-use and tied to redirect URI', () => {
  const fixture = setup();
  try {
    const request = fixture.store.validateRequest(fixture.params);
    assert.throws(() => fixture.store.approve(request, 'incorrect'), AuthorizationError);
    const redirect = new URL(fixture.store.approve(request, SECRET));
    assert.equal(redirect.searchParams.get('state'), 'random-state-123456');
    const code = redirect.searchParams.get('code')!;
    const pair = fixture.store.exchange(code, VERIFIER, REDIRECT);
    assert.equal(pair.token_type, 'Bearer');
    assert.equal(fixture.store.verify(pair.access_token), true);
    assert.throws(() => fixture.store.exchange(code, VERIFIER, REDIRECT), AuthorizationError);
    assert.throws(() => fixture.store.exchange(code, VERIFIER, 'codexmobileui://other'), AuthorizationError);
  } finally { fixture.cleanup(); }
});

test('refresh rotates token and persists opaque token hashes, not raw tokens', () => {
  const fixture = setup();
  try {
    const code = new URL(fixture.store.approve(fixture.store.validateRequest(fixture.params), SECRET))
      .searchParams.get('code')!;
    const first = fixture.store.exchange(code, VERIFIER, REDIRECT);
    const second = fixture.store.refresh(first.refresh_token);
    assert.notEqual(second.refresh_token, first.refresh_token);
    assert.throws(() => fixture.store.refresh(first.refresh_token), AuthorizationError);
    const restarted = new OAuthStore(SECRET, REDIRECT, fixture.file);
    assert.equal(restarted.verify(second.access_token), true);
    restarted.revoke(second.refresh_token);
    assert.equal(restarted.verify(second.access_token), false);
  } finally { fixture.cleanup(); }
});

test('two-stage refresh survives lost replies and restart, then ACK revokes old credential', () => {
  const fixture = setup();
  try {
    const code = new URL(fixture.store.approve(fixture.store.validateRequest(fixture.params), SECRET))
      .searchParams.get('code')!;
    const original = fixture.store.exchange(code, VERIFIER, REDIRECT);
    const requestId = randomBytes(32).toString('hex');
    const next = fixture.store.refresh(original.refresh_token, requestId);
    assert.equal(next.refresh_confirmation_required, true);
    assert.equal(fixture.store.refresh(original.refresh_token, requestId).refresh_token,
      next.refresh_token, 'lost HTTP reply must return the exact same pair');
    assert.throws(() => fixture.store.refresh(original.refresh_token,
      randomBytes(32).toString('hex')), AuthorizationError);
    assert.throws(() => fixture.store.refresh(next.refresh_token,
      randomBytes(32).toString('hex')), AuthorizationError);
    const persisted = readFileSync(fixture.file, 'utf8');
    assert.doesNotMatch(persisted, new RegExp(original.refresh_token));
    assert.doesNotMatch(persisted, new RegExp(next.refresh_token));
    const restarted = new OAuthStore(SECRET, REDIRECT, fixture.file);
    assert.equal(restarted.refresh(original.refresh_token, requestId).access_token,
      next.access_token);
    assert.equal(restarted.verify(next.access_token), true);
    restarted.confirmRefresh(next.refresh_token, requestId);
    restarted.confirmRefresh(next.refresh_token, requestId);
    assert.throws(() => restarted.refresh(original.refresh_token, requestId), AuthorizationError);
    const succeeding = restarted.refresh(next.refresh_token, randomBytes(32).toString('hex'));
    assert.ok(succeeding.refresh_token);
  } finally { fixture.cleanup(); }
});

test('unfinished refresh is time-bounded while the newly stored credential remains recoverable', () => {
  let time = 1_700_000_000_000;
  const fixture = setup(() => time);
  try {
    const code = new URL(fixture.store.approve(fixture.store.validateRequest(fixture.params), SECRET))
      .searchParams.get('code')!;
    const original = fixture.store.exchange(code, VERIFIER, REDIRECT);
    const requestId = randomBytes(32).toString('hex');
    const pending = fixture.store.refresh(original.refresh_token, requestId);
    time += 31 * 60_000;
    assert.throws(() => fixture.store.refresh(original.refresh_token, requestId), AuthorizationError);
    // The phone has the new token but may have lost the ACK.
    const rebooted = new OAuthStore(SECRET, REDIRECT, fixture.file, () => time);
    rebooted.confirmRefresh(pending.refresh_token, requestId);
    const next = rebooted.refresh(pending.refresh_token, randomBytes(32).toString('hex'));
    assert.ok(next.refresh_token);
  } finally { fixture.cleanup(); }
});

test('reject untrusted redirect URI and unauthorized clients', () => {
  const fixture = setup();
  try {
    fixture.params.set('redirect_uri', 'https://attacker.example/steal');
    assert.throws(() => fixture.store.validateRequest(fixture.params), AuthorizationError);
    fixture.params.set('redirect_uri', REDIRECT);
    fixture.params.set('client_id', 'unregistered-app');
    assert.throws(() => fixture.store.validateRequest(fixture.params), AuthorizationError);
  } finally { fixture.cleanup(); }
});

test('expired codes and tokens fail closed', () => {
  let time = 1700000000000;
  const fixture = setup(() => time);
  try {
    const code = new URL(fixture.store.approve(fixture.store.validateRequest(fixture.params), SECRET))
      .searchParams.get('code')!;
    time += 11 * 60_000;
    assert.throws(() => fixture.store.exchange(code, VERIFIER, REDIRECT), AuthorizationError);
    const nextCode = new URL(fixture.store.approve(fixture.store.validateRequest(fixture.params), SECRET))
      .searchParams.get('code')!;
    const token = fixture.store.exchange(nextCode, VERIFIER, REDIRECT);
    time += 16 * 60_000;
    assert.equal(fixture.store.verify(token.access_token), false);
    assert.ok(fixture.store.refresh(token.refresh_token).access_token);
  } finally { fixture.cleanup(); }
});

test('consent can be approved after long delay and after gateway restart', () => {
  let time = 1700000000000;
  const fixture = setup(() => time);
  try {
    const request = fixture.store.validateRequest(fixture.params);
    time += 20 * 60_000;
    const rebooted = new OAuthStore(SECRET, REDIRECT, fixture.file, () => time);
    const code = new URL(rebooted.approve(request, SECRET)).searchParams.get('code')!;
    const restartedAgain = new OAuthStore(SECRET, REDIRECT, fixture.file, () => time);
    assert.throws(() => restartedAgain.exchange(code, 'incorrect-verifier', REDIRECT),
      (error: unknown) => error instanceof AuthorizationError && error.code === 'invalid_grant');
    const pair = restartedAgain.exchange(code, VERIFIER, REDIRECT);
    assert.ok(pair.refresh_token);
    const afterExchangeRestart = new OAuthStore(SECRET, REDIRECT, fixture.file, () => time);
    assert.throws(() => afterExchangeRestart.exchange(code, VERIFIER, REDIRECT),
      (error: unknown) => error instanceof AuthorizationError && error.code === 'invalid_grant');
  } finally { fixture.cleanup(); }
});
