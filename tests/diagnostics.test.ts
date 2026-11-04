import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDiagnosticError,
  sanitizeDiagnosticEvent,
  sanitizeDiagnosticFields,
} from '../src/diagnostics/safe';

test('diagnostic events retain useful timing and state without credentials or user data', () => {
  const safe = sanitizeDiagnosticEvent('auth.browserPromptFinished', {
    attempt: 2,
    durationMs: 1432,
    result: 'success',
    codePresent: true,
    hostUrl: 'https://private-host.ts.net:8443',
    authorizationCode: 'secret_auth_code',
    rawBody: 'private chat content',
    token: 'private_refresh_token',
    threadId: 'private_thread_identifier',
    errorMessage: 'private-native-error',
  });
  assert.deepEqual(safe, {
    event: 'auth.browserPromptFinished',
    fields: { attempt: 2, durationMs: 1432, result: 'success', codePresent: true },
  });
  assert.doesNotMatch(JSON.stringify(safe), /private|secret|token|thread/i);
});

test('diagnostics reject free-form strings and invalid event names', () => {
  assert.deepEqual(sanitizeDiagnosticFields({
    result: 'https://private-host.test/oauth?code=secret',
    errorKind: 'network',
    errorType: 'TypeError',
    step: 'beforeBrowser',
    closeCode: 1006,
    status: NaN,
    count: Infinity,
    durationMs: 9_999_999_999,
  }), { errorKind: 'network', errorType: 'TypeError',
    step: 'beforeBrowser', closeCode: 1006, durationMs: 1_000_000_000 });
  assert.deepEqual(sanitizeDiagnosticFields({ result: 'privateSecret' }), {});
  assert.equal(sanitizeDiagnosticEvent('https://secret', {}).event, 'diagnostics.invalidEvent');
});

test('diagnostic error classification never exports native exception messages', () => {
  const error = new TypeError('Fetch failed https://private.example?token=secret');
  const safe = classifyDiagnosticError(error);
  assert.deepEqual(safe, { errorType: 'TypeError', errorKind: 'network' });
  assert.doesNotMatch(JSON.stringify(safe), /private|secret|https/i);
  const nativeError = Object.assign(new Error('Private native URI'), {
    code: 'ERR_WEB_BROWSER_SESSION_ALREADY_OPEN',
  });
  assert.deepEqual(classifyDiagnosticError(nativeError), {
    errorType: 'Error',
    errorKind: 'other',
    errorCode: 'ERR_WEB_BROWSER_SESSION_ALREADY_OPEN',
  });
});
