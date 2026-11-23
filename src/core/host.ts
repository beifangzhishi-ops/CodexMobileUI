export interface Host {
  id: string;
  name: string;
  baseUrl: string;
}

/** All mobile connections use the private Tailnet listener, not Funnel. */
function isPrivateTailnetUrl(url: URL): boolean {
  const parts = url.hostname.split('.').map(Number);
  return url.protocol === 'http:' && url.port === '48889' &&
    parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

export function isTailnetHost(host: Host): boolean {
  try { return isPrivateTailnetUrl(new URL(host.baseUrl)); }
  catch { return false; }
}

export function parseHost(input: string): Host {
  const url = new URL(input.trim());
  if (!isPrivateTailnetUrl(url) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('请输入 HTTPS 地址或 Tailnet 内网 http://100.x.x.x:48889 地址');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('请填写网关 HTTPS 根地址，不要附加路径');
  }
  const baseUrl = url.origin;
  return { id: baseUrl, name: url.hostname, baseUrl };
}

export function websocketUrl(host: Host): string {
  const machine = /\/machines\/([\w-]{1,32})$/.exec(host.id)?.[1];
  return host.baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:') +
    '/connect' + (machine ? '?host=' + encodeURIComponent(machine) : '');
}

/** Fetch the complete machine roster from one Tailnet coordinator. */
export async function discoverTailnetHosts(address: string): Promise<Host[]> {
  const coordinator = parseHost(address);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(coordinator.baseUrl + '/hosts', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('内网机器列表读取失败：' + response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('hosts' in body) ||
        !Array.isArray(body.hosts) || body.hosts.length === 0 || body.hosts.length > 16) {
      throw new Error('内网机器列表格式错误');
    }
    const hosts = body.hosts.map((item: unknown): Host => {
      if (!item || typeof item !== 'object' || !('url' in item) || !('name' in item) ||
          !('id' in item) || typeof item.id !== 'string' ||
          typeof item.url !== 'string' || typeof item.name !== 'string' ||
          !/^[\w-]{1,32}$/.test(item.id) ||
          !/^[\w-]{1,32}$/.test(item.name)) throw new Error('内网机器信息无效');
      const host = parseHost(item.url);
      return { ...host, id: host.baseUrl + '/machines/' + item.id, name: item.name };
    });
    if (new Set(hosts.map((host) => host.id)).size !== hosts.length ||
        !hosts.some((host) => host.baseUrl === coordinator.baseUrl)) {
      throw new Error('内网机器列表与入口不匹配');
    }
    return hosts;
  } finally {
    clearTimeout(timeout);
  }
}
