/**
 * Funnel exposes an internet-reachable URL. Even after OAuth, never hand out
 * an unrestricted native App Server transport: the Stage 1 mobile UI needs
 * only these exact native RPC operations.
 *
 * A new mobile feature must explicitly add its method here with tests and
 * a review of its effects before being permitted over Funnel.
 */
const MOBILE_REQUESTS = new Set([
  'initialize',
  'thread/list',
  'thread/read',
  'thread/resume',
  'thread/start',
  'turn/start',
]);

export function permitMobileRpcFrame(data: string, isBinary: boolean): {
  allowed: boolean;
  id?: number;
} {
  if (isBinary || data.length > 1_048_576) return { allowed: false };
  let request: unknown;
  try { request = JSON.parse(data); }
  catch { return { allowed: false }; }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { allowed: false };
  }
  const rpc = request as Record<string, unknown>;
  const id = typeof rpc.id === 'number' && Number.isSafeInteger(rpc.id) && rpc.id >= 0
    ? rpc.id : undefined;
  if (rpc.method === 'initialized' && id === undefined &&
      !('result' in rpc) && !('error' in rpc)) {
    return { allowed: true };
  }
  if (typeof rpc.method !== 'string' || !MOBILE_REQUESTS.has(rpc.method) ||
      id === undefined || 'result' in rpc || 'error' in rpc) {
    return { allowed: false, id };
  }
  return { allowed: true, id };
}
