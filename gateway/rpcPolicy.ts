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
  'project/list',
  'project/read',
  'thread/metadata/update',
  'thread/name/set',
]);

function safeParams(method: string, value: unknown): boolean {
  const params = value === undefined ? {} : value;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  const p = params as Record<string, unknown>;
  const keys = Object.keys(p);
  const subset = (allowed: string[]) => keys.every((key) => allowed.includes(key));
  const id = (name: string) => typeof p[name] === 'string' && p[name].length > 0 &&
    p[name].length <= 128;
  switch (method) {
    case 'project/list':
      return subset(['limit', 'cursor']) &&
        (p.limit === undefined || (Number.isInteger(p.limit) && Number(p.limit) >= 1 &&
          Number(p.limit) <= 100)) &&
        (p.cursor === undefined || id('cursor'));
    case 'project/read':
      return subset(['projectId']) && id('projectId');
    case 'thread/metadata/update':
      return subset(['threadId', 'projectId']) && id('threadId') &&
        typeof p.projectId === 'string' && p.projectId.length <= 128;
    case 'thread/name/set':
      return subset(['threadId', 'name']) && id('threadId') &&
        typeof p.name === 'string' && p.name.trim().length > 0 &&
        Array.from(p.name).length <= 80 && !/[\x00-\x1f]/.test(p.name);
    default: return true;
  }
}

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
  const id = typeof rpc.id === 'number' && Number.isSafeInteger(rpc.id) &&
    rpc.id >= 0 && rpc.id < 1_000_000_000
    ? rpc.id : undefined;
  if (rpc.method === 'initialized' && id === undefined &&
      !('result' in rpc) && !('error' in rpc)) {
    return { allowed: true };
  }
  if (typeof rpc.method !== 'string' || !MOBILE_REQUESTS.has(rpc.method) ||
      !safeParams(rpc.method, rpc.params) ||
      id === undefined || 'result' in rpc || 'error' in rpc) {
    return { allowed: false, id };
  }
  return { allowed: true, id };
}
