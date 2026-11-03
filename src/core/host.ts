export interface Host {
  id: string;
  name: string;
  baseUrl: string;
}

/** Keep URLs out of the binary: the owner enters each Funnel HTTPS origin. */
export function parseHost(input: string): Host {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入不含账号、查询参数的 HTTPS 网关地址');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('请填写网关 HTTPS 根地址，不要附加路径');
  }
  const baseUrl = url.origin;
  return { id: baseUrl, name: url.hostname, baseUrl };
}

export function websocketUrl(host: Host): string {
  return host.baseUrl.replace(/^https:/, 'wss:') + '/connect';
}
