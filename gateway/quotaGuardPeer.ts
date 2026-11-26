import type {
  QuotaGuardRuntime, QuotaGuardSetting, QuotaHostId,
} from '../shared/quotaGuard.js';
import { parseQuotaGuardRuntime } from '../shared/quotaGuard.js';
import type { QuotaGuardSettingStore } from './quotaGuardState.js';

export type QuotaGuardPeerSyncRequest = {
  action: 'sync';
  enabled: boolean;
  revision: number;
  updatedAt: number;
  runtime: QuotaGuardRuntime | null;
};

export type QuotaGuardPeerSyncResponse = {
  runtime: QuotaGuardRuntime | null;
};

export type QuotaGuardPeerRequester = (
  params: QuotaGuardPeerSyncRequest,
  timeoutMs: number,
) => Promise<unknown>;

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function quotaGuardPeerSyncRequest(setting: QuotaGuardSetting,
  runtime: QuotaGuardRuntime | null): QuotaGuardPeerSyncRequest {
  return {
    action: 'sync',
    enabled: setting.enabled,
    revision: setting.revision,
    updatedAt: setting.updatedAt,
    runtime,
  };
}

export function parseQuotaGuardPeerSyncRequest(input: unknown,
  sourceHost: QuotaHostId): QuotaGuardPeerSyncRequest | null {
  const data = object(input);
  if (!data || data.action !== 'sync' ||
      Object.keys(data).sort().join(',') !== 'action,enabled,revision,runtime,updatedAt' ||
      typeof data.enabled !== 'boolean' ||
      !Number.isSafeInteger(data.revision) || Number(data.revision) < 0 ||
      !finite(data.updatedAt) || data.updatedAt < 0) return null;
  const runtime = data.runtime === null ? null : parseQuotaGuardRuntime(data.runtime, sourceHost);
  if (data.runtime !== null && runtime === null) return null;
  return {
    action: 'sync',
    enabled: data.enabled,
    revision: Number(data.revision),
    updatedAt: data.updatedAt,
    runtime,
  };
}

export function parseQuotaGuardPeerSyncResponse(input: unknown,
  remoteHost: QuotaHostId): QuotaGuardPeerSyncResponse | null {
  const data = object(input);
  if (!data || Object.keys(data).length !== 1 || !('runtime' in data)) return null;
  const runtime = data.runtime === null ? null : parseQuotaGuardRuntime(data.runtime, remoteHost);
  if (data.runtime !== null && runtime === null) return null;
  return { runtime };
}

/**
 * Apply the authenticated peer envelope on the receiving host. The setting
 * mirror and the source host's own runtime latch stay in separate files so a
 * host never mistakes its local low for a peer low or echoes it back as one.
 */
export function handleQuotaGuardPeerSync(store: QuotaGuardSettingStore,
  input: unknown, sourceHost: QuotaHostId, localHost: QuotaHostId,
  now = Date.now()): QuotaGuardPeerSyncResponse {
  const request = parseQuotaGuardPeerSyncRequest(input, sourceHost);
  if (!request) throw new Error('QUOTA_GUARD_PEER_SYNC_INVALID');
  store.writeMirrorSync(request.enabled, request.revision, request.updatedAt, now);
  if (request.runtime) {
    store.writePeerRuntimeSync(request.runtime, sourceHost, now);
  }
  return { runtime: store.readRuntimeSync(localHost) };
}

/**
 * Send this host's own setting and runtime latch to the peer, then durably
 * retain the peer's independent latch from the response.
 */
export async function synchronizeQuotaGuardPeer(store: QuotaGuardSettingStore,
  localHost: QuotaHostId, remoteHost: QuotaHostId,
  request: QuotaGuardPeerRequester, now = Date.now()): Promise<QuotaGuardRuntime | null> {
  const setting = store.readSettingSync(localHost, now);
  const localRuntime = store.readRuntimeSync(localHost);
  const raw = await request(quotaGuardPeerSyncRequest(setting, localRuntime), 15_000);
  const response = parseQuotaGuardPeerSyncResponse(raw, remoteHost);
  if (!response) throw new Error('QUOTA_GUARD_PEER_SYNC_INVALID');
  if (response.runtime) {
    store.writePeerRuntimeSync(response.runtime, remoteHost, now);
  }
  return store.readPeerRuntimeSync(remoteHost)?.runtime ?? null;
}
