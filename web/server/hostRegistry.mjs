import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const PRIVATE_IP = /^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(\d{1,3})\.(\d{1,3})$/;
const PRIMARY = { id: '6v', displayName: '6v', primary: true };

export function validPeerUrl(value) {
  if (typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  const match = PRIVATE_IP.exec(url.hostname);
  return url.protocol === 'ws:' && match !== null && Number(match[1]) <= 255 &&
    Number(match[2]) <= 255 && url.port === '4191' && url.pathname === '/peer' &&
    !url.username && !url.password && !url.search && !url.hash && value === url.href;
}

export function createHostRegistry(config, stateDir = resolve('.state')) {
  const hasPeers = Object.hasOwn(config, 'peers');
  if (hasPeers && (!Array.isArray(config.peers) || config.peers.length > 15)) {
    throw Error('Invalid peer registry');
  }
  const entries = hasPeers ? config.peers : config.peerUrl ? [{
    id: 'noha', displayName: 'noha', peerUrl: config.peerUrl,
  }] : [];
  const hosts = new Map([[PRIMARY.id, { ...PRIMARY, peerUrl: null, credential: null }]]);
  const endpoints = new Set();
  const credentials = new Set();
  for (const item of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some((key) => !['id', 'displayName', 'peerUrl'].includes(key)) ||
        typeof item.id !== 'string' || !ID.test(item.id) || item.id === 'all' ||
        item.id === '6v' || hosts.has(item.id) ||
        typeof item.displayName !== 'string' || !item.displayName.trim() ||
        item.displayName.length > 80 || !validPeerUrl(item.peerUrl)) {
      throw Error('Invalid peer registry');
    }
    const url = new URL(item.peerUrl);
    if (endpoints.has(url.hostname)) throw Error('Duplicate peer endpoint');
    endpoints.add(url.hostname);
    const credentialPath = resolve(stateDir, hasPeers
      ? 'web-peer-' + item.id + '.token' : 'web-peer-token');
    let credential;
    try { credential = readFileSync(credentialPath, 'utf8').trim(); }
    catch { throw Error('Missing peer credential'); }
    if (!/^[a-f0-9]{64}$/.test(credential) || credentials.has(credential)) {
      throw Error('Invalid peer credential');
    }
    credentials.add(credential);
    hosts.set(item.id, { id: item.id, displayName: item.displayName.trim(),
      peerUrl: item.peerUrl, credential });
  }
  return {
    primaryHostId: PRIMARY.id,
    localHostId: config.hostId ?? 'noha',
    get: (id) => hosts.get(id),
    has: (id) => hosts.has(id),
    list: () => [...hosts.values()].map(({ id, displayName }) => ({ id, displayName })),
  };
}
