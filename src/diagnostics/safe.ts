/**
 * This is deliberately NOT a general-purpose console logger.
 * Never pass host names/URLs, request/response bodies, thread IDs, text,
 * OAuth state, authorization codes, tokens, or native exception messages.
 */
export interface DiagnosticEvent {
  timestamp: string;
  session: string;
  sequence: number;
  event: string;
  fields: Record<string, string | number | boolean | null>;
}

const ALLOWED_KEYS = new Set([
  'step', 'attempt', 'durationMs', 'status', 'result', 'errorType', 'errorKind', 'errorCode',
  'connected', 'count', 'retry', 'codePresent', 'stateMatches', 'browserAvailable',
  'isAvailable', 'appState', 'method', 'closeCode', 'phase', 'outcome', 'platform',
  'schemeMatched', 'storageReady', 'inProgress',
  'buttonEnabled', 'timeoutMs', 'pendingCount', 'noticeCount', 'cacheCount',
]);
const SAFE_ATOM = /^[A-Za-z][A-Za-z0-9_.-]{0,47}$/;
const SAFE_EVENT = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){1,5}$/;
const SAFE_STRING_VALUES: Record<string, Set<string>> = {
  step: new Set(['beforeBrowser', 'afterBrowser', 'beforeStorage', 'afterStorage']),
  result: new Set(['success', 'cancel', 'dismiss', 'locked', 'error', 'opened', 'unknown']),
  errorType: new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'DOMException', 'AbortError', 'UnknownError']),
  errorKind: new Set(['other', 'network', 'timeout', 'browser', 'callback', 'pkce', 'auth', 'permission', 'storage']),
  appState: new Set(['active', 'inactive', 'background', 'unknown', 'extension']),
  method: new Set([
    'initialize', 'thread.list', 'thread.read', 'thread.resume', 'thread.start',
    'turn.start', 'turn.started', 'turn.completed', 'item.completed', 'batch', 'other',
  ]),
  phase: new Set(['preparing', 'opening', 'waiting', 'saving', 'complete', 'failed']),
  outcome: new Set(['success', 'failed', 'cancelled', 'pending']),
  platform: new Set(['android', 'ios', 'web', 'windows', 'unknown']),
};

export function sanitizeDiagnosticFields(
  input: Record<string, unknown> = {},
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (typeof value === 'boolean' || value === null) {
      result[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = Math.max(-1_000_000_000, Math.min(1_000_000_000, value));
    } else if (typeof value === 'string' && SAFE_ATOM.test(value) &&
        ((key === 'errorCode' && /^(?:ERR_|E_)[A-Z0-9_]{2,44}$/.test(value)) ||
         SAFE_STRING_VALUES[key]?.has(value))) {
      result[key] = value;
    }
  }
  return result;
}

export function sanitizeDiagnosticEvent(
  event: string,
  input: Record<string, unknown> = {},
): { event: string; fields: DiagnosticEvent['fields'] } {
  return {
    event: SAFE_EVENT.test(event) ? event : 'diagnostics.invalidEvent',
    fields: sanitizeDiagnosticFields(input),
  };
}

/** Classify, but do not serialize, the underlying exception message. */
export function classifyDiagnosticError(error: unknown): {
  errorType: string;
  errorKind: string;
  errorCode?: string;
} {
  const record = error && typeof error === 'object'
    ? error as { name?: unknown; message?: unknown; code?: unknown } : {};
  const name = typeof record.name === 'string' ? record.name : '';
  const type = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'DOMException', 'AbortError']
    .includes(name) ? name : 'UnknownError';
  const text = typeof record.message === 'string' ? record.message.toLowerCase() : '';
  let kind = 'other';
  if (/network|fetch|internet|connection|connect|offline|dns|socket/.test(text)) kind = 'network';
  else if (/timeout|timed out|超时/.test(text)) kind = 'timeout';
  else if (/browser|activity|intent|custom tab|webbrowser|浏览器/.test(text)) kind = 'browser';
  else if (/state|redirect|callback|回跳/.test(text)) kind = 'callback';
  else if (/pkce|verifier|crypto|random/.test(text)) kind = 'pkce';
  else if (/token|oauth|auth|授权/.test(text)) kind = 'auth';
  else if (/permission|denied|security/.test(text)) kind = 'permission';
  else if (/sqlite|database|storage|disk|securestore|存储/.test(text)) kind = 'storage';
  // Only standardized symbolic codes, never arbitrary error strings.
  const code = typeof record.code === 'string' && /^(?:ERR_|E_)[A-Z0-9_]{2,44}$/.test(record.code)
    ? record.code : undefined;
  return { errorType: type, errorKind: kind, ...(code ? { errorCode: code } : {}) };
}
