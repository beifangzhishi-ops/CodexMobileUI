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
  'thread/archive',
  'thread/unarchive',
  'thread/delete',
  'project/list',
  'project/read',
  'project/create',
  'project/update',
  'project/delete',
  'model/list',
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
  const title = (name: string) => typeof p[name] === 'string' &&
    p[name].trim().length > 0 && Array.from(p[name] as string).length <= 80 &&
    !/[\x00-\x1f]/.test(p[name] as string);
  switch (method) {
    case 'thread/archive':
    case 'thread/unarchive':
    case 'thread/delete':
      return subset(['threadId']) && id('threadId');
    case 'model/list':
      return subset(['limit', 'cursor']) &&
        (p.limit === undefined || Number.isInteger(p.limit) && Number(p.limit) >= 1 &&
          Number(p.limit) <= 100) &&
        (p.cursor === undefined || id('cursor'));
    case 'project/create':
      // Mobile may create an empty project, but cannot supply arbitrary host paths.
      return subset(['name', 'roots', 'idempotencyKey']) && title('name') &&
        Array.isArray(p.roots) && p.roots.length === 0 && id('idempotencyKey');
    case 'project/update':
      return subset(['projectId', 'name']) && id('projectId') && title('name');
    case 'project/delete':
      return subset(['projectId']) && id('projectId');
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
      return subset(['threadId', 'name']) && id('threadId') && title('name');
    case 'turn/start':
      // A mobile model/effort picker must not become an unrestricted
      // sandbox/approval-policy override on the public relay.
      if (!subset(['threadId', 'input', 'model', 'effort', 'serviceTierForTurn'])) return false;
      if (p.threadId === undefined && p.input === undefined && keys.length === 0) return true;
      return id('threadId') && Array.isArray(p.input) && p.input.length === 1 &&
        p.input.every((item: unknown) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
          const input = item as Record<string, unknown>;
          return Object.keys(input).every((key) => ['type', 'text'].includes(key)) &&
            input.type === 'text' && typeof input.text === 'string' &&
            input.text.trim().length > 0 && input.text.length <= 12000;
        }) &&
        (p.model === undefined || typeof p.model === 'string' && /^[\w.-]{1,80}$/.test(p.model)) &&
        (p.effort === undefined || ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(String(p.effort))) &&
        (p.serviceTierForTurn === undefined || ['default', 'fast'].includes(String(p.serviceTierForTurn)));
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
