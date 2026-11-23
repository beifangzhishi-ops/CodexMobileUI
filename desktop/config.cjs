'use strict';

const os = require('node:os');
const path = require('node:path');

const HOSTS = ['6v', 'noha'];
const DEFAULT_IPS = Object.freeze({ '6v': '100.76.74.124', noha: '100.96.30.32' });

function isPrivateIPv4(value) {
  if (typeof value !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const octets = value.split('.').map(Number);
  if (octets.some((part) => part > 255)) return false;
  const [a, b] = octets;
  return a === 127 || a === 10 || (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

function normalizeServerUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 200) throw Error('INVALID_SERVER_URL');
  let url;
  try { url = new URL(raw.trim()); } catch { throw Error('INVALID_SERVER_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash || !url.port && !url.hostname ||
    !(isPrivateIPv4(url.hostname) || url.hostname === 'localhost' ||
      (url.protocol === 'https:' && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/.test(url.hostname)))) {
    throw Error('SERVER_MUST_BE_PRIVATE');
  }
  return url.origin + '/';
}

function defaultSettings(computerName = os.hostname()) {
  const localHost = /noha/i.test(computerName) ? 'noha' : '6v';
  return {
    // The Coordinator validates its HTTP Host header; using its Tailnet endpoint
    // also works from 6v without a second localhost-origin configuration.
    serverUrl: 'https://cpa-node.tail7c23f0.ts.net:4190/',
    localHost,
    hostIps: { ...DEFAULT_IPS },
    // This is an optional SMB share name, not a remote filesystem root assertion.
    hostShares: { '6v': '6v1f', noha: 'noha' },
    windowBounds: null,
  };
}

function parseSettings(input, computerName) {
  const defaults = defaultSettings(computerName);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaults;
  const localHost = HOSTS.includes(input.localHost) ? input.localHost : defaults.localHost;
  const hostIps = {}, hostShares = {};
  for (const host of HOSTS) {
    const ip = input.hostIps?.[host] ?? defaults.hostIps[host];
    if (!isPrivateIPv4(ip)) throw Error('INVALID_HOST_IP_' + host);
    hostIps[host] = ip;
    const share = input.hostShares?.[host] ?? defaults.hostShares[host];
    if (typeof share !== 'string' || !/^[\w$-]{1,40}$/.test(share)) throw Error('INVALID_HOST_SHARE_' + host);
    hostShares[host] = share;
  }
  let bounds = null;
  const b = input.windowBounds;
  if (b && [b.x, b.y, b.width, b.height].every(Number.isInteger) &&
    b.width >= 650 && b.width <= 8000 && b.height >= 400 && b.height <= 8000 &&
    Math.abs(b.x) <= 100000 && Math.abs(b.y) <= 100000) bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  return { serverUrl: normalizeServerUrl(input.serverUrl ?? defaults.serverUrl),
    localHost, hostIps, hostShares, windowBounds: bounds };
}

function fileCandidates(settings, hostId, rawPath) {
  if (!HOSTS.includes(hostId) || typeof rawPath !== 'string' || rawPath.length > 2048 ||
    /[\x00-\x1f]/.test(rawPath)) throw Error('INVALID_HOST_FILE');
  if (/^\\\\/.test(rawPath)) {
    const normalized = path.win32.normalize(rawPath);
    for (const remote of HOSTS) {
      const accepted = [
        `\\\\${settings.hostIps[remote]}\\${settings.hostShares[remote]}\\`,
        `\\\\${settings.hostIps[remote]}\\C$\\`,
      ];
      for (const prefix of accepted) {
        if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) {
          const suffix = normalized.slice(prefix.length);
          return settings.localHost === remote ? ['C:\\' + suffix] : [normalized];
        }
      }
    }
    throw Error('UNRECOGNIZED_NETWORK_FILE');
  }
  if (!/^[A-Za-z]:[\\/]/.test(rawPath)) throw Error('INVALID_HOST_FILE');
  const drive = rawPath[0].toUpperCase();
  const full = path.win32.normalize(rawPath);
  if (settings.localHost === hostId) return [full];
  const ip = settings.hostIps[hostId];
  if (!isPrivateIPv4(ip)) throw Error('INVALID_HOST_IP');
  const suffix = full.slice(3);
  const candidates = [];
  // A user-defined C-drive SMB share can coexist with Windows' C$ administrative share.
  if (drive === 'C' && settings.hostShares[hostId]) {
    candidates.push(`\\\\${ip}\\${settings.hostShares[hostId]}\\${suffix}`);
  }
  candidates.push(`\\\\${ip}\\${drive}$\\${suffix}`);
  return [...new Set(candidates)];
}

module.exports = { HOSTS, defaultSettings, parseSettings, normalizeServerUrl, isPrivateIPv4, fileCandidates };
