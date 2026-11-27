import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { win32 } from 'node:path';

export const DEFAULT_PATH_HOSTS = Object.freeze({
  '6v': { ip: '100.76.74.124', share: '6v1f' },
  noha: { ip: '100.96.30.32', share: 'noha' },
});
const validHost = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(id) && !['all', 'constructor', 'prototype'].includes(id);
const ABSOLUTE_START = /(?:[A-Za-z]:[\\/]|\\\\[\w.-]+\\[\w$.-]+\\)/g;
const PATH_END = /[\r\n\t<>"'`|]/;
const TRAILING = /[\s.,!?;:\uff0c\u3002\uff01\uff1f\uff1b)\]\}]+$/u;

export function validatePathHosts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length > 16 || !Object.keys(value).every(validHost)) throw Error('INVALID_PATH_HOSTS');
  const result = {};
  for (const id of Object.keys(value)) {
    const item = value[id];
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).sort().join(',') !== 'ip,share') throw Error('INVALID_PATH_HOST');
    const ip = item.ip, share = item.share;
    if (typeof ip !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) throw Error('INVALID_PATH_IP');
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255) ||
        !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 ||
          parts[0] === 10 || parts[0] === 192 && parts[1] === 168 ||
          parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)) throw Error('INVALID_PATH_IP');
    if (typeof share !== 'string' || !/^[\w$-]{1,40}$/.test(share)) throw Error('INVALID_PATH_SHARE');
    result[id] = { ip, share };
  }
  return result;
}

export function localToNetwork(localPath, owner, hosts) {
  if (!validHost(owner) || typeof localPath !== 'string' ||
      !/^[Cc]:[\\/]/.test(localPath)) return null;
  const item = hosts[owner];
  if (!item) return null;
  const normalized = win32.normalize(localPath);
  return `\\\\${item.ip}\\${item.share}\\${normalized.slice(3)}`;
}

export function networkToLocal(remotePath, hosts) {
  if (typeof remotePath !== 'string') return null;
  const normalized = remotePath.replace(/\//g, '\\');
  for (const id of Object.keys(hosts)) {
    const prefix = `\\\\${hosts[id].ip}\\${hosts[id].share}`;
    if (normalized.toLowerCase() === prefix.toLowerCase()) return { owner: id, path: 'C:\\' };
    if (normalized.toLowerCase().startsWith((prefix + '\\').toLowerCase())) {
      return { owner: id, path: 'C:\\' + normalized.slice(prefix.length + 1) };
    }
  }
  return null;
}

export function pathForViewer(path, originHost, viewerHost, hosts) {
  if (!validHost(viewerHost)) return path;
  const network = networkToLocal(path, hosts);
  if (network) return network.owner === viewerHost ? network.path :
    localToNetwork(network.path, network.owner, hosts) ?? path;
  if (!validHost(originHost) || !/^[Cc]:[\\/]/.test(path)) return path;
  return originHost === viewerHost ? win32.normalize(path) :
    localToNetwork(path, originHost, hosts) ?? path;
}

async function readable(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() && !info.isDirectory()) return false;
    await access(path, constants.R_OK);
    return true;
  } catch { return false; }
}

async function probeInputPath(raw, destinationHost, hosts, probe = readable) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\x00-\x1f]/.test(raw) ||
      !validHost(destinationHost)) return { value: raw, status: 'missing' };
  const known = networkToLocal(raw, hosts);
  if (known) {
    const target = known.owner === destinationHost ? known.path :
      localToNetwork(known.path, known.owner, hosts);
    return target && await probe(target) ?
      { value: target, status: target === raw ? 'same' : 'mapped' } :
      { value: raw, status: 'missing' };
  }
  if (!/^[A-Za-z]:[\\/]/.test(raw)) return { value: raw, status: 'missing' };
  const path = win32.normalize(raw);
  const candidates = [];
  // C: is shared by both machines. Never choose based only on a matching filename.
  if (path[0].toUpperCase() === 'C') {
    for (const id of new Set([destinationHost, ...Object.keys(hosts)])) {
      const candidate = id === destinationHost ? path : localToNetwork(path, id, hosts);
      if (candidate) candidates.push(candidate);
    }
  } else candidates.push(path); // No other drive shares are configured.
  const results = await Promise.all(candidates.map(async (candidate) =>
    await probe(candidate) ? candidate : null));
  const matches = results.filter(Boolean);
  if (matches.length > 1) return { value: raw, status: 'ambiguous' };
  if (matches.length === 1) return {
    value: matches[0], status: matches[0] === raw ? 'same' : 'mapped',
  };
  return { value: raw, status: 'missing' };
}

export async function resolveInputPath(raw, destinationHost, hosts, probe = readable) {
  return (await probeInputPath(raw, destinationHost, hosts, probe)).value;
}

/** Physical files chosen in Electron have a known owner: never cross-probe by filename. */
export async function resolveSelectedFile(path, owner, destination, hosts, probe = readable) {
  if (!validHost(owner) || !validHost(destination) ||
      typeof path !== 'string' || path.length > 2048 ||
      /[\x00-\x1f]/.test(path) || !/^[A-Za-z]:[\\/]/.test(path)) return null;
  const normalized = win32.normalize(path);
  const candidate = owner === destination ? normalized : localToNetwork(normalized, owner, hosts);
  return candidate && await probe(candidate) ? candidate : null;
}

/** User input only. Assistant prose is NEVER rewritten by this parser. */
export async function resolveUserTextDetailed(source, destinationHost, hosts, probe = readable) {
  if (typeof source !== 'string' || source.length > 12000) throw Error('INVALID_PATH_TEXT');
  let output = '', consumed = 0, count = 0;
  const changes = [];
  const ambiguities = [];
  const starts = [...source.matchAll(ABSOLUTE_START)];
  for (let index = 0; index < starts.length; index++) {
    const match = starts[index];
    if (++count > 24) break;
    const nextStart = starts[index + 1]?.index ?? source.length;
    const candidate = source.slice(match.index, nextStart);
    const fragment = candidate.slice(0, candidate.search(PATH_END) < 0 ?
      candidate.length : candidate.search(PATH_END));
    let result = null;
    // Try the longest actual path first. A filename may contain spaces, but
    // trailing ordinary words/punctuation must never become part of a path.
    const ends = new Set([fragment.length]);
    for (let i = 1; i < fragment.length; i++) {
      if (/[\s)\]\},!?;:\uff0c\u3002\uff01\uff1f\uff1b]/u.test(fragment[i])) ends.add(i);
    }
    for (const end of [...ends].sort((a, b) => b - a)) {
      const raw = fragment.slice(0, end).replace(TRAILING, '');
      if (!raw || !/\\|\//.test(raw.slice(2))) continue;
      const { value: mapped, status } = await probeInputPath(raw, destinationHost, hosts, probe);
      if (status === 'ambiguous') {
        ambiguities.push(raw);
        break;
      }
      if (status === 'mapped') { result = { end: raw.length, mapped, from: raw }; break; }
      if (status === 'same') break;
    }
    if (!result) continue;
    output += source.slice(consumed, match.index) + result.mapped;
    changes.push({ from: result.from, to: result.mapped });
    consumed = match.index + result.end;
  }
  return { text: output + source.slice(consumed), changes, ambiguities };
}

export async function resolveUserText(source, destinationHost, hosts, probe = readable) {
  return (await resolveUserTextDetailed(source, destinationHost, hosts, probe)).text;
}
