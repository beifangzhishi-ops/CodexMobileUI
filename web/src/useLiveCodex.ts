import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, HostId, Message } from './types';
import {
  applyNotice, obj, parseGoal, parseModels, parsePermissions, parseProjects, parseQueue,
  parseSnapshot, parseThreads, parseThreadForkResponse, reconcileObservedReasoning, text, threadPreviewTitle,
} from './nativeProtocol';
import type {
  NativeGoal, NativeModel, NativePermission, NativeProject, NativeQueueEntry,
  NativeThreadForkParams,
} from './nativeProtocol';
import { localMessageId } from './browserHelpers';
import type { NativeMention } from '../../shared/mentions';
import { parseContextWindowUsage, type ContextWindowUsage } from '../../shared/contextUsage';
import { parseRateQuota, type RateQuota } from '../../shared/rateLimits';
import {
  parseQuotaGuardSharedState, type QuotaGuardSharedState,
} from '../../shared/quotaGuard';
import { desktopFileMessage } from '../../shared/desktopFileReferences';
import { uploadDocument } from './documentUpload';
import { hasAbsolutePaths, type PathHosts } from './pathHosts';
import { displayOriginalPaths, readPathOverlays, storePathOverlay, type PathChange } from './pathOverlays';
import { desktopBridge } from './desktopBridge';
import { permissionFingerprint, readCustomPermission, storeCustomPermission } from './permissionPreference';
import { compactionBusy, compactionOutcome, type CompactionJob, type CompactionPhase } from './compaction';

type Params = Record<string, unknown>;
type Frame = { id?: number; method?: string; params?: Params; result?: unknown; error?: { message?: string; code?: number }; type?: string };
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number };
type Client = { socket: WebSocket; pending: Map<number, Pending>; seq: number; ready: boolean };
type HostStatus = 'connecting' | 'online' | 'offline';
export type PermissionMode = 'default' | 'auto-review' | 'read-only' | 'full-access' | 'custom';
export type FollowUpMode = 'steer' | 'queue';
export type SendOptions = {
  preparedAttachments?: { imagePaths: string[]; uploadedDocuments: { name: string; path: string }[] };
  pathHosts?: PathHosts;
  mentions?: NativeMention[];
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  nextPermission?: PermissionMode;
  onPermissionApplied?: () => void;
  plan?: boolean;
  goal?: string;
  followUpMode?: FollowUpMode;
  images?: File[];
  documents?: File[];
  signal?: AbortSignal;
  onUploadsDone?: () => void;
  onUploadProgress?: (received: number, total: number) => void;
  onCreated?: (id: string) => void;
  onAccepted?: (threadId: string, turnId: string, steered: boolean) => void;
};
export type Approval = { hostId: HostId; id: number; method: string; detail: string };
const HOSTS: HostId[] = ['6v', 'noha'];
const permissionParams = (mode: PermissionMode | undefined): Params =>
  mode === 'default' ? { permissions: ':workspace', approvalsReviewer: 'user' } :
  mode === 'auto-review' ? { permissions: ':workspace', approvalsReviewer: 'auto_review' } :
  mode === 'read-only' ? { permissions: ':read-only', approvalsReviewer: 'user' } :
  mode === 'full-access' ? { permissions: ':danger-full-access', approvalsReviewer: 'user' } : {};
const permissionId = (mode: PermissionMode) => permissionParams(mode).permissions as string | undefined;
const threadKey = (hostId: HostId, id: string) => hostId + ':' + id;

export function useLiveCodex() {
  const [status, setStatus] = useState<Record<HostId, HostStatus>>({ '6v': 'connecting', noha: 'connecting' });
  const [errors, setErrors] = useState<Record<HostId, string | null>>({ '6v': null, noha: null });
  const [rateQuota, setRateQuota] = useState<Partial<Record<HostId, RateQuota>>>({});
  const [quotaGuard, setQuotaGuard] = useState<QuotaGuardSharedState | null>(null);
  const [projects, setProjects] = useState<NativeProject[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [models, setModels] = useState<Record<HostId, NativeModel[]>>({ '6v': [], noha: [] });
  const [permissions, setPermissions] = useState<Record<HostId, NativePermission[]>>({ '6v': [], noha: [] });
  const [threadPermissions, setThreadPermissions] = useState<Record<string, PermissionMode>>({});
  const [customPermissionChanged, setCustomPermissionChanged] = useState<Record<string, boolean>>({});
  const [goals, setGoals] = useState<Record<string, NativeGoal | null>>({});
  const [queues, setQueues] = useState<Record<string, NativeQueueEntry[]>>({});
  const [contextUsages, setContextUsages] = useState<Record<string, ContextWindowUsage>>({});
  const [compactions, setCompactions] = useState<Record<string, CompactionPhase>>({});
  const compactionJobs = useRef(new Map<string, CompactionJob>());
  const setCompactionPhase = useCallback((key: string, phase: CompactionPhase) => {
    const job = compactionJobs.current.get(key);
    if (!job) return;
    job.phase = phase;
    if (!compactionBusy(phase) || phase === 'unknown') {
      if (job.timer !== undefined) window.clearTimeout(job.timer);
      job.timer = undefined;
    }
    setCompactions((all) => ({ ...all, [key]: phase }));
  }, []);
  const waitingForModelTurn = useRef(new Set<string>());
  const [approval, setApproval] = useState<Approval | null>(null);
  const clients = useRef(new Map<HostId, Client>());
  const active = useRef<{ hostId: HostId; threadId: string } | null>(null);
  // Keep an explicitly chosen config-based mode across in-page navigation,
  // even when config.toml resolves to the same named profile as a preset.
  const permissionSelections = useRef(new Map<string, {
    mode: PermissionMode; profile: string | null; reviewer: string | null; fingerprint?: string | null;
  }>());
  const permissionEpochs = useRef(new Map<string, number>());
  /** Serializes settings writes for each native thread; turn/start waits for pending writes. */
  const modelUpdates = useRef(new Map<string, Promise<void>>());
  const changed = useRef(new Map<string, number>());
  // A very fast model can finish before the turn/start acknowledgement is
  // processed. Never revive a completed turn as "running" on late ack.
  const completedTurnIds = useRef(new Map<string, string>());
  const startingTurns = useRef(new Set<string>());
  const sideLoadedThreads = useRef(new Set<string>());
  const refreshTimer = useRef(new Map<string, number>());
  const pollQueued = useRef(new Map<string, number>());
  const alive = useRef(false);

  const request = useCallback((hostId: HostId, method: string, params: Params = {}, timeoutMs = 25_000): Promise<unknown> => {
    const client = clients.current.get(hostId);
    if (!client?.ready || client.socket.readyState !== WebSocket.OPEN) return Promise.reject(Error('HOST_OFFLINE'));
    const id = ++client.seq;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        client.pending.delete(id);
        reject(Error('REQUEST_UNCONFIRMED'));
      }, timeoutMs);
      client.pending.set(id, { resolve, reject, timer });
      try { client.socket.send(JSON.stringify({ id, method, params })); }
      catch { clearTimeout(timer); client.pending.delete(id); reject(Error('REQUEST_UNCONFIRMED')); }
    });
  }, []);

  const refreshRateQuota = useCallback(async (hostId: HostId) => {
    const snapshot = parseRateQuota(await request(hostId, 'account/rateLimits/read', {}));
    if (snapshot) setRateQuota((previous) => ({ ...previous, [hostId]: snapshot }));
  }, [request]);

  const refreshQuotaGuard = useCallback(async () => {
    const response = obj(await request('6v', 'quotaGuard/state', {}));
    const state = parseQuotaGuardSharedState(response.state);
    if (!state) throw Error('QUOTA_GUARD_STATE_INVALID');
    setQuotaGuard(state);
    return state;
  }, [request]);

  const setQuotaGuardEnabled = useCallback(async (enabled: boolean) => {
    const state = quotaGuard ?? await refreshQuotaGuard();
    const response = obj(await request('6v', 'quotaGuard/set', {
      enabled, expectedRevision: state.revision,
    }, 20_000));
    const updated = parseQuotaGuardSharedState(response.state);
    if (!updated) throw Error('QUOTA_GUARD_STATE_INVALID');
    setQuotaGuard(updated);
    return updated;
  }, [quotaGuard, refreshQuotaGuard, request]);

  const pageList = useCallback(async (hostId: HostId, method: 'project/list' | 'thread/list' | 'thread/queue/list', extra: Params = {}) => {
    const rows: unknown[] = [], cursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const params = { limit: 100, ...(method === 'thread/list' ? { sortKey: 'recency_at', modelProviders: [] } : {}), ...extra,
        ...(cursor ? { cursor } : {}) };
      const result = obj(await request(hostId, method, params));
      if (!Array.isArray(result.data)) throw Error('INVALID_SERVER_LIST');
      rows.push(...result.data);
      if (result.nextCursor == null) return { data: rows };
      const next = text(result.nextCursor);
      if (!next || cursors.has(next)) throw Error('INVALID_CURSOR');
      cursors.add(next);
      cursor = next;
    }
    throw Error('TOO_MANY_PAGES');
  }, [request]);

  const refresh = useCallback(async (hostId: HostId) => {
    const [p, activeThreads, archivedThreads] = await Promise.all([
      pageList(hostId, 'project/list'), pageList(hostId, 'thread/list'),
      pageList(hostId, 'thread/list', { archived: true }),
    ]);
    const parsed = [...parseThreads(activeThreads, hostId), ...parseThreads(archivedThreads, hostId, true)];
    const byId = new Map<string, Conversation>();
    for (const item of parsed) if (!byId.has(item.id)) byId.set(item.id, item);
    setProjects((all) => [...all.filter((p) => p.hostId !== hostId), ...parseProjects(p, hostId)]);
    setConversations((all) => {
      const previous = new Map(all.filter((item) => item.hostId === hostId).map((item) => [item.id, item]));
      const next = [...byId.values()].map((item) => {
        const old = previous.get(item.id);
        return old ? { ...item,
          model: item.model || old.model, reasoningEffort: item.reasoningEffort || old.reasoningEffort,
          messages: old.messages, localCreated: false,
          running: old.running ?? item.running,
          activeTurnId: old.activeTurnId, runningSinceMs: old.runningSinceMs, syncPending: old.syncPending,
          status: old.syncPending ? 'running' as const : old.status } : item;
      });
      // New threads may be ephemeral until native persistence. Do not vanish an
      // acknowledged first send just because it has not reached thread/list.
      // Do not keep phantom Web conversations indefinitely. A persisted thread
      // absent from the complete native list was deleted or moved elsewhere.
      // Only retain fresh, not-yet-indexed native thread/start acknowledgments.
      const pending = [...previous.values()].filter((item) => !byId.has(item.id) && !item.archived &&
        (item.attachedToThreadId || item.localCreated && (item.running || Date.now() - item.updatedAt < 10 * 60_000)));
      return [...all.filter((item) => item.hostId !== hostId), ...pending, ...next];
    });
    setErrors((all) => ({ ...all, [hostId]: null }));
    try {
      const list = parseModels(await request(hostId, 'model/list', { limit: 100 }));
      setModels((all) => ({ ...all, [hostId]: list }));
    }
    catch { /* Older native versions may not expose model/list. */ }
    try {
      const list = parsePermissions(await request(hostId, 'permissionProfile/list', {}));
      setPermissions((all) => ({ ...all, [hostId]: list }));
    }
    catch { /* Permissions stay unavailable; never infer access. */ }
  }, [pageList, request]);

  const forgetDeletedThread = useCallback((hostId: HostId, threadId: string) => {
    setConversations((all) => all.filter((item) => !(item.hostId === hostId && item.id === threadId)));
    waitingForModelTurn.current.delete(threadKey(hostId, threadId));
    modelUpdates.current.delete(threadKey(hostId, threadId));
    storeCustomPermission(threadKey(hostId, threadId), null);
    setContextUsages((all) => {
      const next = { ...all };
      delete next[threadKey(hostId, threadId)];
      return next;
    });
    if (active.current?.hostId === hostId && active.current.threadId === threadId) active.current = null;
  }, []);

  const clearContextUsage = useCallback((hostId: HostId, threadId: string) => {
    // A model choice applies to the next turn. Old-turn updates cannot repopulate
    // the circle with the previous model's capacity in the meantime.
    waitingForModelTurn.current.add(threadKey(hostId, threadId));
    setContextUsages((all) => {
      if (!all[threadKey(hostId, threadId)]) return all;
      const next = { ...all };
      delete next[threadKey(hostId, threadId)];
      return next;
    });
  }, []);

  const readThread = useCallback(async (hostId: HostId, threadId: string): Promise<Message[]> => {
    const key = threadKey(hostId, threadId);
    const eventVersion = changed.current.get(key) ?? 0;
    const [native, overlays] = await Promise.all([
      request(hostId, 'thread/read', { threadId, includeTurns: true }),
      readPathOverlays(hostId, threadId).catch(() => []),
    ]);
    const snapshot = parseSnapshot(native, threadId);
    const job = compactionJobs.current.get(key);
    if (job?.dispatched && compactionBusy(job.phase)) {
      const outcome = compactionOutcome(job, snapshot.messages);
      if (outcome === 'completed' || outcome === 'failed') setCompactionPhase(key, outcome);
    }
    const thread = obj(obj(native).thread);
    snapshot.messages = displayOriginalPaths(snapshot.messages, overlays);
    if (eventVersion !== (changed.current.get(key) ?? 0)) {
      // Do not overwrite newer streaming messages with an older asynchronous read.
      return snapshot.messages;
    }
    setConversations((all) => all.map((item) => {
      if (item.hostId !== hostId || item.id !== threadId) return item;
      const liveError = snapshot.activeTurnId && item.messages.find((message) =>
        message.kind === 'turnError' && message.turnId === snapshot.activeTurnId);
      const observed = reconcileObservedReasoning(snapshot.messages, item.messages, native);
      const messages = liveError ? [...observed, liveError] : observed;
      const runningSinceMs = snapshot.activeTurnId && snapshot.activeTurnId === item.activeTurnId
        ? item.runningSinceMs ?? snapshot.runningSinceMs : snapshot.runningSinceMs;
      return { ...item, ...snapshot, messages, runningSinceMs,
        model: text(thread.model) || item.model,
        reasoningEffort: text(thread.reasoningEffort) || item.reasoningEffort,
        status: snapshot.running ? 'running' : 'idle', syncPending: false };
    }));
    return snapshot.messages;
  }, [request, setCompactionPhase]);

  const listSideChats = useCallback(async (hostId: HostId, parentId: string) => {
    const result = await pageList(hostId, 'thread/list', { attachedToThreadId: parentId,
      archived: false, useStateDbOnly: true });
    const rows = parseThreads(result, hostId).filter((item) => item.id !== parentId)
      .map((item) => ({ ...item, attachedToThreadId: parentId }));
    setConversations((all) => {
      const previous = new Map(all.filter((item) => item.hostId === hostId).map((item) => [item.id, item]));
      const ids = new Set(rows.map((item) => item.id));
      return [...all.filter((item) => item.hostId !== hostId ||
        !ids.has(item.id) && (item.attachedToThreadId !== parentId || item.localCreated)),
        ...rows.map((item) => {
          const old = previous.get(item.id);
          return old ? { ...old, ...item, messages: old.messages, localCreated: false,
            running: item.running, activeTurnId: item.running ? old.activeTurnId : null,
            runningSinceMs: item.running ? old.runningSinceMs : null } : item;
        })];
    });
    return rows;
  }, [pageList]);

  const creatingSideChats = useRef(new Set<string>());
  const createSideChat = useCallback(async (hostId: HostId, parentId: string) => {
    const key = threadKey(hostId, parentId);
    if (creatingSideChats.current.has(key)) throw Error('SIDE_CHAT_BUSY');
    creatingSideChats.current.add(key);
    try {
      const response = obj(await request(hostId, 'thread/fork',
        { threadId: parentId, attachToSource: true, excludeTurns: true }, 90_000));
      const thread = obj(response.thread), id = text(thread.id);
      if (!id || id === parentId) throw Error('SIDE_CHAT_UNCONFIRMED');
      const [parsed] = parseThreads({ data: [thread] }, hostId);
      if (!parsed) throw Error('SIDE_CHAT_UNCONFIRMED');
      setConversations((all) => [...all.filter((item) => item.hostId !== hostId || item.id !== id),
        { ...parsed, attachedToThreadId: parentId, localCreated: true, updatedAt: Date.now() }]);
      void listSideChats(hostId, parentId).catch(() => undefined);
      return id;
    } finally { creatingSideChats.current.delete(key); }
  }, [request, listSideChats]);

  const loadSideChat = useCallback(async (hostId: HostId, threadId: string) => {
    await request(hostId, 'thread/resume', { threadId });
    sideLoadedThreads.current.add(threadKey(hostId, threadId));
    return readThread(hostId, threadId);
  }, [request, readThread]);

  const readSubAgent = useCallback(async (hostId: HostId, threadId: string, agentThreadId: string) => {
    const result = await request(hostId, 'web/subAgent/read', { threadId, agentThreadId });
    return parseSnapshot(result, agentThreadId);
  }, [request]);

  const refreshQueue = useCallback(async (hostId: HostId, threadId: string) => {
    const result = await pageList(hostId, 'thread/queue/list', { threadId });
    const list = parseQueue(result);
    setQueues((current) => ({ ...current, [threadKey(hostId, threadId)]: list }));
    return list;
  }, [pageList]);

  const refreshGoal = useCallback(async (hostId: HostId, threadId: string) => {
    const result = obj(await request(hostId, 'thread/goal/get', { threadId }));
    const goal = parseGoal(result.goal, threadId);
    setGoals((current) => ({ ...current, [threadKey(hostId, threadId)]: goal }));
    return goal;
  }, [request]);

  const select = useCallback(async (hostId: HostId, threadId: string, searchHit?: Conversation) => {
    if (searchHit?.id === threadId && searchHit.hostId === hostId) {
      setConversations((all) => all.some((item) => item.hostId === hostId && item.id === threadId)
        ? all : [...all, searchHit]);
    }
    active.current = { hostId, threadId };
    const messages = await readThread(hostId, threadId);
    const key = threadKey(hostId, threadId);
    const epoch = permissionEpochs.current.get(key) ?? 0;
    void request(hostId, 'thread/resume', { threadId }).then(async (result) => {
      if ((permissionEpochs.current.get(key) ?? 0) !== epoch) return;
      const resumed = obj(result);
      setConversations((all) => all.map((item) => item.hostId === hostId && item.id === threadId
        ? { ...item, model: text(resumed.model) || item.model,
          reasoningEffort: text(resumed.reasoningEffort) || item.reasoningEffort } : item));
      const profile = text(obj(resumed.activePermissionProfile).id) || null;
      const reviewer = text(resumed.approvalsReviewer) || null;
      if (!profile && !reviewer) return;
      const inferred: PermissionMode = profile === ':workspace' ? (reviewer === 'auto_review' ? 'auto-review' : 'default') :
        profile === ':read-only' ? 'read-only' : profile === ':danger-full-access' ? 'full-access' : 'custom';
      const selected = permissionSelections.current.get(key);
      const saved = selected?.mode === 'custom' ? selected.fingerprint || readCustomPermission(key) : readCustomPermission(key);
      const actual = saved ? await permissionFingerprint(resumed).catch(() => null) : null;
      if ((permissionEpochs.current.get(key) ?? 0) !== epoch) return;
      const mode = saved && actual === saved ? 'custom' :
        !saved && selected && selected.profile === profile && selected.reviewer === reviewer ? selected.mode : inferred;
      setCustomPermissionChanged((all) => ({ ...all, [key]: Boolean(saved && actual && actual !== saved) }));
      if (selected && mode !== selected.mode) permissionSelections.current.delete(key);
      setThreadPermissions((all) => ({ ...all, [key]: mode }));
    }).catch(() => undefined);
    void refreshQueue(hostId, threadId).catch(() => undefined);
    void refreshGoal(hostId, threadId).catch(() => undefined);
    return messages;
  }, [readThread, refreshQueue, refreshGoal, request]);

  const uploadImage = useCallback(async (hostId: HostId, file: File,
    onProgress: (received: number) => void, signal?: AbortSignal) => {
    const limit = 8 * 1024 * 1024;
    if (file.size < 8 || file.size > limit ||
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(file.type)) {
      throw Error('IMAGE_FORMAT_OR_SIZE_UNSUPPORTED');
    }
    const raw = new Uint8Array(await file.arrayBuffer());
    const safeName = file.name && file.name.length <= 100 && !/[\\/\x00-\x1f]/.test(file.name)
      ? file.name : 'clipboard-image';
    const uploadId = text(obj(await request(hostId, 'web/image/start', {
      name: safeName, size: raw.byteLength, mime: file.type,
    })).uploadId);
    if (!uploadId) throw Error('IMAGE_UPLOAD_START_UNCONFIRMED');
    try {
      for (let offset = 0; offset < raw.byteLength;) {
        if (signal?.aborted) throw Error('UPLOAD_CANCELLED');
        const bytes = raw.subarray(offset, offset + 48 * 1024);
        const encoded = btoa(String.fromCharCode(...bytes));
        const received = Number(obj(await request(hostId, 'web/image/chunk',
          { uploadId, offset, data: encoded }, 30_000)).received);
        if (received !== offset + bytes.byteLength) throw Error('IMAGE_UPLOAD_OFFSET_MISMATCH');
        offset = received;
        onProgress(offset);
      }
      if (signal?.aborted) throw Error('UPLOAD_CANCELLED');
      const path = text(obj(await request(hostId, 'web/image/finish', { uploadId })).path);
      if (!path) throw Error('IMAGE_UPLOAD_FINISH_UNCONFIRMED');
      if (signal?.aborted) throw Error('UPLOAD_CANCELLED');
      return path;
    } catch (error) {
      // Do not retry an ambiguous upload. An orphaned partial upload is only
      // temporary host storage, never a previously accepted model message.
      void request(hostId, 'web/image/cancel', { uploadId }, 3000).catch(() => undefined);
      throw error;
    }
  }, [request]);

  const readImage = useCallback(async (hostId: HostId, threadId: string,
    itemId: string, imageIndex: number,
    method: 'web/image/read' | 'web/image/assistantRead' | 'web/image/toolRead' = 'web/image/read',
    turnId?: string): Promise<Blob> => {
    let offset = 0;
    let total: number | null = null;
    let mime = '';
    let image: Uint8Array<ArrayBuffer> | null = null;
    for (let attempt = 0; attempt < 180; attempt++) {
      const result = obj(await request(hostId, method,
        method === 'web/image/toolRead' ? { threadId, turnId, itemId, offset } :
          { threadId, itemId, imageIndex, offset }, 15_000));
      const newTotal = Number(result.total), received = Number(result.received), part = text(result.data);
      const currentMime = text(result.mime);
      if (!Number.isSafeInteger(newTotal) || newTotal < 8 || newTotal > 8 * 1024 * 1024 ||
          !Number.isSafeInteger(received) || received <= offset || received > newTotal ||
          !['image/png','image/jpeg','image/webp','image/gif','image/bmp'].includes(currentMime) ||
          typeof result.data !== 'string') throw Error('INVALID_IMAGE_READ');
      if (total === null) { total = newTotal; mime = currentMime; image = new Uint8Array(newTotal); }
      if (newTotal !== total || currentMime !== mime || !image) throw Error('IMAGE_CHANGED_DURING_READ');
      const bytes = atob(part);
      if (bytes.length !== received - offset) throw Error('CORRUPT_IMAGE_CHUNK');
      for (let i = 0; i < bytes.length; i++) image[offset + i] = bytes.charCodeAt(i);
      offset = received;
      if (received === total) return new Blob([image], { type: mime });
    }
    throw Error('IMAGE_TOO_MANY_CHUNKS');
  }, [request]);
  const readAssistantImage = useCallback((hostId: HostId, threadId: string,
    itemId: string, imageIndex: number) =>
    readImage(hostId, threadId, itemId, imageIndex, 'web/image/assistantRead'), [readImage]);
  const readToolImage = useCallback((hostId: HostId, threadId: string,
    turnId: string, itemId: string) =>
    readImage(hostId, threadId, itemId, 0, 'web/image/toolRead', turnId), [readImage]);

  useEffect(() => {
    alive.current = true;
    const retryTimers: number[] = [];
    const sockets = new Set<WebSocket>();
    function connect(hostId: HostId, attempt = 0) {
      if (!alive.current) return;
      setStatus((s) => ({ ...s, [hostId]: attempt ? 'offline' : 'connecting' }));
      const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') +
        location.host + '/api/connect?host=' + hostId);
      sockets.add(socket);
      const client: Client = { socket, pending: new Map(), seq: 0, ready: false };
      clients.current.set(hostId, client);
      socket.onmessage = (ev) => {
        if (!alive.current || clients.current.get(hostId) !== client) return;
        let frame: Frame;
        try { frame = JSON.parse(String(ev.data)) as Frame; } catch { return; }
        if (frame.type === 'ready') {
          client.ready = true;
          void request(hostId, 'initialize', {
            clientInfo: { name: 'codex_multi_host_web', title: 'Codex Web', version: '0.1.0' },
            capabilities: { experimentalApi: true, requiredHumanApproval: true },
          }).then(() => {
            if (!alive.current || clients.current.get(hostId) !== client) return;
            socket.send(JSON.stringify({ method: 'initialized', params: {} }));
            setStatus((s) => ({ ...s, [hostId]: 'online' }));
            void refreshRateQuota(hostId).catch(() => undefined);
            if (hostId === '6v') void refreshQuotaGuard().catch(() => undefined);
            void refresh(hostId).catch(() =>
              setErrors((s) => ({ ...s, [hostId]: '同步列表失败，请手动刷新' })));
            if (active.current?.hostId === hostId) void select(hostId, active.current.threadId).catch(() => undefined);
          }).catch(() => { socket.close(); });
          return;
        }
        if (typeof frame.id === 'number' && !frame.method) {
          const pending = client.pending.get(frame.id);
          if (!pending) return;
          clearTimeout(pending.timer); client.pending.delete(frame.id);
          if (frame.error) pending.reject(Error(frame.error.message || 'RPC_FAILED'));
          else pending.resolve(frame.result);
          return;
        }
        if (!frame.method) return;
        const params = obj(frame.params);
        if (frame.method === 'account/rateLimits/updated') {
          // Native rolling notifications may omit fields. Re-read instead of replacing the snapshot.
          void refreshRateQuota(hostId).catch(() => undefined);
        }
        if (frame.method === 'quotaGuard/updated') {
          const state = parseQuotaGuardSharedState(obj(params.state));
          if (state) setQuotaGuard(state);
        }
        if (typeof frame.id === 'number') {
          // Only allow responding to an actual pending approval request.
          const allowed = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(frame.method);
          if (!allowed) return;
          const command = text(params.command) || text(obj(params.item).command);
          const reason = text(params.reason) || text(params.description);
          setApproval({ hostId, id: frame.id, method: frame.method,
            detail: [command, reason].filter(Boolean).join('\n\n') || '本次请求没有提供可核对的操作详情' });
          return;
        }
        const threadId = text(params.threadId) || text(obj(params.thread).id);
        if (threadId) {
          const key = threadKey(hostId, threadId);
          const compaction = compactionJobs.current.get(key);
          if (compaction?.dispatched && compactionBusy(compaction.phase)) {
            if (['item/started', 'item/completed'].includes(frame.method) &&
                obj(params.item).type === 'contextCompaction') {
              const turnId = text(params.turnId), itemId = text(obj(params.item).id);
              if (turnId && itemId && !compaction.baseline.has(turnId + ':' + itemId)) {
                compaction.turnId = turnId;
                setCompactionPhase(key, 'working');
              }
            }
            if (frame.method === 'turn/completed' && compaction.turnId &&
                text(obj(params.turn).id) === compaction.turnId) {
              const status = text(obj(params.turn).status);
              setCompactionPhase(key, status === 'completed' ? 'completed' : 'failed');
            }
          }
          if (frame.method === 'thread/tokenUsage/updated') {
            const usage = parseContextWindowUsage(params.tokenUsage);
            if (usage && !waitingForModelTurn.current.has(key))
              setContextUsages((all) => ({ ...all, [key]: usage }));
            return; // Usage notifications do not invalidate concurrent message snapshots.
          }
          if (frame.method === 'thread/settings/updated') {
            const updated = obj(params.threadSettings);
            setConversations((all) => all.map((item) => item.hostId === hostId && item.id === threadId
              ? { ...item, model: text(updated.model) || item.model,
                reasoningEffort: text(updated.effort) || item.reasoningEffort } : item));
          }
          if (frame.method === 'thread/deleted') forgetDeletedThread(hostId, threadId);
          if (frame.method === 'turn/started') waitingForModelTurn.current.delete(key);
          changed.current.set(key, (changed.current.get(key) ?? 0) + 1);
          if (frame.method === 'turn/started') {
            const turn = obj(params.turn);
            const turnId = text(turn.id);
            const now = performance.timeOrigin + performance.now();
            const startedAt = !startingTurns.current.has(key) && typeof turn.startedAt === 'number'
              ? Math.min(turn.startedAt * 1000, now) : now;
            setConversations((all) => all.map((c) => c.hostId === hostId && c.id === threadId
              ? { ...c, status: 'running', running: true, syncPending: false,
                activeTurnId: turnId || c.activeTurnId,
                runningSinceMs: turnId === c.activeTurnId ? c.runningSinceMs ?? startedAt : startedAt } : c));
          } else if (frame.method === 'turn/completed') {
            const turnId = text(obj(params.turn).id);
            if (turnId) completedTurnIds.current.set(key, turnId);
            setConversations((all) => all.map((c) => {
              if (c.hostId !== hostId || c.id !== threadId) return c;
              const completed = !c.activeTurnId || !turnId || c.activeTurnId === turnId;
              return { ...c, messages: applyNotice(c.messages, { method: frame.method!, params }),
                ...(completed ? { status: 'idle' as const, running: false, activeTurnId: null, runningSinceMs: null } : {}) };
            }));
          } else if (frame.method === 'error' || frame.method === 'item/started' || frame.method === 'item/completed' ||
                     frame.method === 'item/agentMessage/delta' || frame.method === 'item/reasoning/summaryTextDelta' ||
                     frame.method === 'item/reasoning/textDelta' ||
                     frame.method === 'item/plan/delta' || frame.method === 'item/commandExecution/outputDelta') {
            setConversations((all) => all.map((c) => c.hostId === hostId && c.id === threadId
              ? { ...c, messages: applyNotice(c.messages, { method: frame.method!, params }) } : c));
          }
          if (frame.method === 'thread/queue/changed' && active.current?.threadId === threadId) {
            void refreshQueue(hostId, threadId).catch(() => undefined);
          }
          if (frame.method === 'thread/goal/updated') {
            try {
              const goal = parseGoal(params.goal, threadId);
              setGoals((g) => ({ ...g, [key]: goal }));
            } catch { /* Ignore malformed goal event. */ }
          }
          if (frame.method === 'thread/goal/cleared') setGoals((g) => ({ ...g, [key]: null }));
          if (frame.method === 'turn/completed' && (sideLoadedThreads.current.has(key) ||
              active.current?.hostId === hostId && active.current.threadId === threadId)) {
            if (refreshTimer.current.has(key)) clearTimeout(refreshTimer.current.get(key));
            refreshTimer.current.set(key, window.setTimeout(() => {
              void readThread(hostId, threadId).catch(() => undefined);
              void refresh(hostId).catch(() => undefined);
            }, 700));
          }
        }
        if (['thread/started', 'thread/name/updated', 'thread/project/updated',
          'thread/archived', 'thread/unarchived', 'thread/deleted'].includes(frame.method) ||
          frame.method.startsWith('project/')) {
          const key = 'list:' + hostId;
          if (refreshTimer.current.has(key)) clearTimeout(refreshTimer.current.get(key));
          refreshTimer.current.set(key, window.setTimeout(() => {
            void refresh(hostId).catch(() => undefined);
          }, 600));
        }
      };
      socket.onclose = () => {
        sockets.delete(socket);
        if (!alive.current || clients.current.get(hostId) !== client) return;
        client.ready = false;
        setStatus((s) => ({ ...s, [hostId]: 'offline' }));
        for (const [key, job] of compactionJobs.current)
          if (key.startsWith(hostId + ':') && compactionBusy(job.phase)) setCompactionPhase(key, 'unknown');
        setConversations((all) => all.map((item) => item.hostId === hostId && item.running
          ? { ...item, syncPending: true } : item));
        if (active.current?.hostId === hostId) setApproval(null);
        for (const entry of client.pending.values()) { clearTimeout(entry.timer); entry.reject(Error('REQUEST_UNCONFIRMED')); }
        client.pending.clear();
        const delay = Math.min(20_000, 1200 * 2 ** Math.min(attempt, 4));
        retryTimers.push(window.setTimeout(() => connect(hostId, attempt + 1), delay));
      };
      socket.onerror = () => { /* onclose owns reconnection */ };
    }
    for (const hostId of HOSTS) connect(hostId);
    const quotaTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      for (const hostId of HOSTS) {
        if (clients.current.get(hostId)?.ready) void refreshRateQuota(hostId).catch(() => undefined);
      }
      if (clients.current.get('6v')?.ready) void refreshQuotaGuard().catch(() => undefined);
    }, 5 * 60_000);
    return () => {
      alive.current = false;
      clearInterval(quotaTimer);
      retryTimers.forEach(clearTimeout);
      for (const socket of sockets) socket.close();
      for (const client of clients.current.values()) {
        for (const entry of client.pending.values()) { clearTimeout(entry.timer); entry.reject(Error('CONNECTION_CLOSED')); }
      }
      clients.current.clear();
      for (const timer of refreshTimer.current.values()) clearTimeout(timer);
      for (const timer of pollQueued.current.values()) clearTimeout(timer);
      refreshTimer.current.clear();
      pollQueued.current.clear();
    };
  }, [refresh, refreshGoal, readThread, refreshQueue, request, select, refreshRateQuota,
    refreshQuotaGuard, setCompactionPhase]);

  const recheckCompaction = useCallback(async (hostId: HostId, threadId: string) => {
    const key = threadKey(hostId, threadId), job = compactionJobs.current.get(key);
    if (!job || job.phase !== 'unknown') return;
    const native = await request(hostId, 'thread/read', { threadId, includeTurns: true });
    const snapshot = parseSnapshot(native, threadId);
    const outcome = compactionOutcome(job, snapshot.messages);
    if (outcome === 'completed' || outcome === 'failed') setCompactionPhase(key, outcome);
    else if (!snapshot.running) setCompactionPhase(key, 'unconfirmed');
    void readThread(hostId, threadId).catch(() => undefined);
  }, [request, readThread, setCompactionPhase]);

  const compactThread = useCallback(async (hostId: HostId, threadId: string) => {
    const key = threadKey(hostId, threadId), old = compactionJobs.current.get(key);
    if (compactionBusy(old?.phase) || startingTurns.current.has(key)) throw Error('THREAD_BUSY');
    const job: CompactionJob = { phase: 'starting', baseline: new Set() };
    compactionJobs.current.set(key, job);
    setCompactionPhase(key, 'starting');
    let dispatched = false;
    try {
      const native = await request(hostId, 'thread/read', { threadId, includeTurns: true });
      const snapshot = parseSnapshot(native, threadId);
      if (snapshot.running || !snapshot.messages.length || startingTurns.current.has(key)) throw Error('THREAD_BUSY');
      job.baseline = new Set(snapshot.messages.filter((m) => m.activityType === 'contextCompaction').map((m) => m.id));
      if ((await refreshQueue(hostId, threadId)).length || startingTurns.current.has(key)) throw Error('THREAD_BUSY');
      dispatched = true;
      job.dispatched = true;
      job.timer = window.setTimeout(() => {
        if (compactionBusy(job.phase)) setCompactionPhase(key, 'unknown');
      }, 120_000);
      await request(hostId, 'thread/compact/start', { threadId }, 30_000);
      if (job.phase === 'starting') setCompactionPhase(key, 'working');
      void readThread(hostId, threadId).catch(() => undefined);
    } catch (error) {
      if (job.phase !== 'completed' && job.phase !== 'failed')
        setCompactionPhase(key, dispatched && (String(error).includes('UNCONFIRMED') || job.phase === 'unknown') ? 'unknown' : 'failed');
      throw error;
    }
  }, [request, refreshQueue, readThread, setCompactionPhase]);

  const prepareAttachments = useCallback(async (hostId: HostId, files: File[],
    documents: File[], options: SendOptions) => {
    const imagePaths: string[] = [];
    const uploadedDocuments: { name: string; path: string }[] = [];
    const totalBytes = [...documents, ...files].reduce((size, file) => size + file.size, 0);
    let uploadedBytes = 0;
    for (const file of documents) {
      if (options.signal?.aborted) throw Error('UPLOAD_CANCELLED');
      const base = uploadedBytes;
      const native = desktopBridge();
      if (native?.filePath && options.pathHosts) {
        let path = '';
        try { path = native.filePath(file); } catch { /* Browser File lacks a native path. */ }
        if (/^[A-Za-z]:[\\/]/.test(path)) {
          const localHost = await native.localHost?.().catch(() => null);
          if (localHost === '6v' || localHost === 'noha') {
            const resolved = obj(await request(hostId, 'web/pathFile', {
              path, sourceHost: localHost, hosts: options.pathHosts,
            }).catch(() => null));
            if (typeof resolved.path === 'string' && resolved.path) {
              uploadedDocuments.push({ name: file.name, path: resolved.path });
              uploadedBytes += file.size;
              options.onUploadProgress?.(uploadedBytes, totalBytes);
              continue;
            }
          }
        }
      }
      uploadedDocuments.push(await uploadDocument(hostId, file, request,
        options.signal, (received) => options.onUploadProgress?.(base + received, totalBytes)));
      uploadedBytes += file.size;
    }
    for (const file of files) {
      if (options.signal?.aborted) throw Error('UPLOAD_CANCELLED');
      const base = uploadedBytes;
      imagePaths.push(await uploadImage(hostId, file, (received) =>
        options.onUploadProgress?.(base + received, totalBytes), options.signal));
      uploadedBytes += file.size;
    }
    if (options.signal?.aborted) throw Error('UPLOAD_CANCELLED');
    return { imagePaths, uploadedDocuments };
  }, [request, uploadImage]);

  const setThreadPermission = useCallback(async (hostId: HostId, threadId: string, mode: PermissionMode) => {
    const key = threadKey(hostId, threadId);
    permissionEpochs.current.set(key, (permissionEpochs.current.get(key) ?? 0) + 1);
    if (mode === 'custom') {
      // The host, not the browser, resolves config.toml and verifies the exact
      // sandbox, policy and reviewer on the persisted thread before replying.
      const applied = obj(await request(hostId, 'web/permissionFromConfig', { threadId }, 90_000));
      if (!['user', 'auto_review', 'guardian_subagent'].includes(text(applied.reviewer))) {
        throw Error('PERMISSION_NOT_CONFIRMED');
      }
      const actual = obj(await request(hostId, 'thread/resume', { threadId }));
      const fingerprint = await permissionFingerprint(actual).catch(() => null);
      if (text(obj(actual.activePermissionProfile).id) !== text(applied.profile) ||
          text(actual.approvalsReviewer) !== text(applied.reviewer)) throw Error('PERMISSION_NOT_CONFIRMED');
      permissionSelections.current.set(key, {
        mode, profile: text(applied.profile) || null, reviewer: text(applied.reviewer), fingerprint,
      });
      storeCustomPermission(key, fingerprint);
      setCustomPermissionChanged((all) => ({ ...all, [key]: false }));
      setThreadPermissions((all) => ({ ...all, [key]: mode }));
      return;
    }
    const expected = permissionParams(mode);
    if (!permissions[hostId].some((p) => p.id === expected.permissions && p.allowed)) throw Error('PERMISSION_NOT_ALLOWED');
    await request(hostId, 'thread/settings/update', { threadId, ...expected }, 30_000);
    const actual = obj(await request(hostId, 'thread/resume', { threadId }));
    if (text(obj(actual.activePermissionProfile).id) !== expected.permissions ||
        text(actual.approvalsReviewer) !== expected.approvalsReviewer) throw Error('PERMISSION_NOT_CONFIRMED');
    permissionSelections.current.set(key, {
      mode, profile: text(obj(actual.activePermissionProfile).id) || null,
      reviewer: text(actual.approvalsReviewer) || null,
    });
    storeCustomPermission(key, null);
    setCustomPermissionChanged((all) => ({ ...all, [key]: false }));
    setThreadPermissions((all) => ({ ...all, [key]: mode }));
  }, [permissions, request]);

  const setThreadModel = useCallback((hostId: HostId, threadId: string, model: string, effort: string) => {
    const key = threadKey(hostId, threadId);
    const previous = modelUpdates.current.get(key) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(async () => {
      const chosen = models[hostId].find((candidate) => candidate.id === model || candidate.model === model);
      if (!chosen) throw Error('MODEL_NOT_AVAILABLE');
      if (!chosen.efforts.includes(effort)) throw Error('EFFORT_NOT_AVAILABLE');
      await request(hostId, 'thread/settings/update', { threadId, model: chosen.id, effort }, 30_000);
      const resumed = obj(await request(hostId, 'thread/resume', { threadId }));
      if (text(resumed.model) !== chosen.id || text(resumed.reasoningEffort) !== effort)
        throw Error('MODEL_SETTINGS_NOT_CONFIRMED');
      setConversations((all) => all.map((item) => item.hostId === hostId && item.id === threadId
        ? { ...item, model: chosen.id, reasoningEffort: effort } : item));
    });
    modelUpdates.current.set(key, work);
    void work.finally(() => { if (modelUpdates.current.get(key) === work) modelUpdates.current.delete(key); }).catch(() => undefined);
    return work;
  }, [models, request]);

  const moveThread = useCallback(async (hostId: HostId, threadId: string, projectId: string) => {
    const response = obj(await request(hostId, 'thread/metadata/update', { threadId, projectId }));
    const thread = obj(response.thread);
    if (thread.id !== threadId || (thread.projectId ?? '') !== projectId) throw Error('MOVE_UNCONFIRMED');
    setConversations((all) => all.map((item) => item.hostId === hostId && item.id === threadId
      ? { ...item, project: projectId || null } : item));
  }, [request]);

  const send = useCallback(async (hostId: HostId, existingId: string | null,
    projectId: string | null, value: string, options: SendOptions) => {
    const messageText = value.trim();
    const files = options.images ?? [];
    const documents = options.documents ?? [];
    const goalOnly = !messageText && !files.length && !documents.length && Boolean(options.goal?.trim());
    if ((!messageText && !files.length && !documents.length && !goalOnly) ||
        messageText.length > 12_000 || files.length + documents.length > 4)
      throw Error('TEXT_OR_IMAGE_REQUIRED_OR_TOO_LONG');
    if (status[hostId] !== 'online') throw Error('HOST_OFFLINE');
    if (existingId && compactionBusy(compactionJobs.current.get(threadKey(hostId, existingId))?.phase)) throw Error('THREAD_BUSY');
    if ((files.length || documents.length) && existingId && options.followUpMode === 'queue')
      throw Error('QUEUE_IMAGES_UNSUPPORTED');
    const perm = options.permissionMode ?? 'default';
    // Persisted threads own their permission state; per-turn overrides would
    // silently replace the chosen profile or inherited config.toml defaults.
    const nativePerms = existingId ? {} : permissionParams(perm);
    const profile = existingId ? undefined : permissionId(perm);
    if (profile && !permissions[hostId].some((p) => p.id === profile && p.allowed)) throw Error('PERMISSION_NOT_ALLOWED');
    const nativeModel = options.model ? models[hostId].find((m) => m.id === options.model) : undefined;
    if (options.model && !nativeModel) throw Error('MODEL_NOT_AVAILABLE');
    if (options.effort && !nativeModel?.efforts.includes(options.effort)) throw Error('EFFORT_NOT_AVAILABLE');
    const settings: Params = {
      ...(nativeModel ? { model: nativeModel.id } : {}),
      ...(options.effort ? { effort: options.effort } : {}),
      ...nativePerms,
      ...(options.plan ? { collaborationMode: {
        mode: 'plan', settings: {
          model: nativeModel?.id ?? models[hostId].find((m) => m.isDefault)?.id,
          reasoning_effort: options.effort || nativeModel?.defaultEffort || null,
          developer_instructions: null,
        } } } : {}),
    };
    if (options.plan && !obj(settings.collaborationMode).settings) throw Error('PLAN_MODEL_UNAVAILABLE');
    const { imagePaths, uploadedDocuments } = options.preparedAttachments ??
      await prepareAttachments(hostId, files, documents, options);
    if (options.signal?.aborted) throw Error('UPLOAD_CANCELLED');
    options.onUploadsDone?.();
    // This is the exact native Codex Desktop file-reference envelope, shared
    // with the prior Android implementation. Never invent a file-content RPC.
    // Only user-authored absolute paths are rewritten. Native assistant output
    // and ordinary assistant prose never go through this resolver.
    let resolvedMessage = messageText;
    let pathChanges: PathChange[] = [];
    if (hasAbsolutePaths(messageText)) {
      if (!options.pathHosts) throw Error('PATH_HOSTS_UNAVAILABLE');
      const response = obj(await request(hostId, 'web/pathResolve', {
        text: messageText, hosts: options.pathHosts,
      }, 30_000));
      if (typeof response.text !== 'string') throw Error('PATH_RESOLVE_UNCONFIRMED');
      if (Array.isArray(response.ambiguities) && response.ambiguities.length)
        throw Error('PATH_AMBIGUOUS');
      resolvedMessage = response.text;
      if (Array.isArray(response.changes)) {
        pathChanges = response.changes.filter((item): item is PathChange => {
          const row = obj(item);
          return typeof row.from === 'string' && typeof row.to === 'string';
        }).slice(0, 24);
      }
    }
    const nativeText = desktopFileMessage(resolvedMessage, uploadedDocuments);
    if (nativeText.length > 12_000) throw Error('DOCUMENT_REFERENCES_TOO_LONG');
    const nativeInput = [
      { type: 'text', text: nativeText },
      ...(options.mentions ?? []),
      ...imagePaths.map((path) => ({ type: 'localImage', path })),
    ];
    let threadId = existingId;
    if (!threadId) {
      const response = obj(await request(hostId, 'web/start', { projectId, ...nativePerms,
        ...(nativeModel ? { model: nativeModel.id } : {}),
        ...(options.effort ? { effort: options.effort } : {}) }, 30_000));
      threadId = text(obj(response.thread).id);
      if (!threadId) throw Error('THREAD_START_UNCONFIRMED');
      const id = threadId;
      setConversations((current) => current.some((c) => c.id === id && c.hostId === hostId) ? current : [{
        id, hostId, project: projectId, archived: false,
        model: nativeModel?.id ?? null, reasoningEffort: options.effort || nativeModel?.defaultEffort || null,
        title: threadPreviewTitle(goalOnly ? options.goal! : messageText),
        status: 'idle', running: false, activeTurnId: null, localCreated: true,
        updatedAt: Date.now(), messages: [],
      }, ...current]);
      active.current = { hostId, threadId: id };
      options.onCreated?.(id);
    } else {
      const key = threadKey(hostId, threadId);
      await modelUpdates.current.get(key);
      const resumed = obj(await request(hostId, 'thread/resume', { threadId }));
      const actualModel = text(resumed.model);
      const actualEffort = text(resumed.reasoningEffort);
      setConversations((all) => all.map((item) => item.hostId === hostId && item.id === threadId
        ? { ...item, model: actualModel || item.model, reasoningEffort: actualEffort || item.reasoningEffort } : item));
      // Existing turns inherit the server-confirmed thread model; never replace it
      // with a stale host-wide dropdown setting. Plan-mode parameters must agree.
      delete settings.model;
      delete settings.effort;
      if (options.plan && settings.collaborationMode) {
        const collaboration = settings.collaborationMode as { settings: { model?: string; reasoning_effort?: string | null } };
        collaboration.settings.model = actualModel || nativeModel?.id;
        collaboration.settings.reasoning_effort = actualEffort || null;
      }
    }
    const id = threadId;
    if (goalOnly) {
      await request(hostId, 'thread/goal/set', { threadId: id, origin: 'user', objective: options.goal!.trim() });
      void refreshGoal(hostId, id).catch(() => undefined);
      return { threadId: id, queued: false };
    }
    const currentThread = conversations.find((c) => c.id === id && c.hostId === hostId);
    if (options.followUpMode === 'queue' && existingId) {
      if (options.plan || options.goal) throw Error('QUEUE_TEXT_ONLY');
      const queued = obj(await request(hostId, 'thread/queue/add', {
        threadId: id, clientUserMessageId: localMessageId(),
        input: nativeInput,
      }, 30_000));
      if (!text(obj(queued.queuedSubmission).id)) throw Error('QUEUE_UNCONFIRMED');
      void refreshQueue(hostId, id).catch(() => undefined);
      return { threadId: id, queued: true };
    }
    const running = Boolean(currentThread?.running);
    if (running && !currentThread?.activeTurnId) throw Error('RUNNING_TURN_SYNC_PENDING');
    if (running && (options.plan || options.goal)) throw Error('WAIT_FOR_NEXT_TURN');
    const key = threadKey(hostId, id);
    if (compactionBusy(compactionJobs.current.get(key)?.phase)) throw Error('THREAD_BUSY');
    if (!running && existingId && options.nextPermission) {
      try {
        await setThreadPermission(hostId, id, options.nextPermission);
      } catch {
        throw Error('NEXT_PERMISSION_UNCONFIRMED');
      }
      options.onPermissionApplied?.();
    }
    if (!running) startingTurns.current.add(key);
    const response = await (running
      ? request(hostId, 'turn/steer', { threadId: id,
        input: nativeInput, expectedTurnId: currentThread!.activeTurnId }, 30_000)
      : request(hostId, 'turn/start', { threadId: id, input: nativeInput, ...settings }, 30_000))
      .then(obj).finally(() => { if (!running) startingTurns.current.delete(key); });
    const nativeTurnId = running ? text(response.turnId) || currentThread!.activeTurnId! : text(obj(response.turn).id);
    if (!nativeTurnId) throw Error('TURN_UNCONFIRMED');
    if (pathChanges.length) {
      // Metadata is optional and never retriggers an already accepted native turn.
      void storePathOverlay({ hostId, threadId: id, turnId: nativeTurnId,
        changes: pathChanges }).catch(() => undefined);
    }
    options.onAccepted?.(id, nativeTurnId, running);
    const alreadyCompleted = completedTurnIds.current.get(key) === nativeTurnId;
    const acknowledgedAt = performance.timeOrigin + performance.now();
    setConversations((all) => all.map((item) => item.hostId === hostId && item.id === id ? {
      ...item, status: alreadyCompleted ? 'idle' : 'running',
      running: !alreadyCompleted, syncPending: false,
      activeTurnId: alreadyCompleted ? null : nativeTurnId,
      runningSinceMs: alreadyCompleted ? null : item.activeTurnId === nativeTurnId
        ? item.runningSinceMs ?? acknowledgedAt : acknowledgedAt,
      updatedAt: Date.now(),
    } : item));
    // The browser-only optimistic bubble remains visible until the native
    // user item arrives. Never fabricate a second user item in canonical history.
    window.setTimeout(() => { void readThread(hostId, id).catch(() => undefined); }, 1000);
    // A valid acknowledgment is already final for delivery. Goal is a separate
    // server mutation and must not trigger a resend if it fails.
    if (options.goal?.trim()) {
      try {
        await request(hostId, 'thread/goal/set', { threadId: id, origin: 'user', objective: options.goal.trim() });
        void refreshGoal(hostId, id).catch(() => undefined);
      } catch { return { threadId: id, queued: false, goalFailed: true }; }
    }
    return { threadId: id, queued: false };
  }, [models, permissions, conversations, request, readThread, refreshGoal, refreshQueue, status, prepareAttachments, setThreadPermission]);

  const renameThread = useCallback(async (hostId: HostId, threadId: string, name: string) => {
    await request(hostId, 'thread/name/set', { threadId, name });
    // Only show the new name after the native server has acknowledged it.
    // All sidebar appearances and the active header share this state.
    setConversations((all) => all.map((entry) => entry.hostId === hostId && entry.id === threadId
      ? { ...entry, title: name } : entry));
    void refresh(hostId).catch(() => undefined);
  }, [request, refresh]);

  const interrupt = useCallback(async (hostId: HostId, threadId: string) => {
    const item = conversations.find((entry) => entry.hostId === hostId && entry.id === threadId);
    if (!item?.activeTurnId) throw Error('NO_ACTIVE_TURN');
    await request(hostId, 'turn/interrupt', { threadId, turnId: item.activeTurnId });
    void readThread(hostId, threadId).catch(() => undefined);
  }, [conversations, readThread, request]);

  const forkThread = useCallback(async (hostId: HostId, threadId: string, lastTurnId: string) => {
    const original = conversations.find((c) => c.hostId === hostId && c.id === threadId);
    if (!original || !original.messages.some((m) => m.turnId === lastTurnId && m.role === 'assistant' &&
        !m.kind && ['completed', 'interrupted', 'failed'].includes(m.turnStatus ?? ''))) {
      throw Error('TURN_NOT_COMPLETE');
    }
    const forkParams: NativeThreadForkParams = {
      threadId, lastTurnId, excludeTurns: true,
    };
    const response = parseThreadForkResponse(
      await request(hostId, 'thread/fork', forkParams, 90_000));
    const fork = response.thread;
    const newId = fork.id;
    if (!newId || newId === threadId) throw Error('FORK_NOT_CONFIRMED');
    setConversations((all) => all.some((c) => c.id === newId && c.hostId === hostId) ? all : [{
      id: newId, hostId, project: fork.projectId || original.project,
      title: fork.name || original.title, status: 'idle', running: false,
      activeTurnId: null, localCreated: true, updatedAt: Date.now(), messages: [],
    }, ...all]);
    // The native fork ID is the success boundary. A later history read may fail
    // during a transient disconnect, but the acknowledged fork remains open.
    await select(hostId, newId).catch(() => undefined);
    void refresh(hostId).catch(() => undefined);
    return newId;
  }, [conversations, refresh, request, select]);

  const setGoal = useCallback(async (hostId: HostId, threadId: string, goal: string) => {
    const objective = goal.trim();
    if (!objective || Array.from(objective).length > 4000 || objective.includes('\0')) throw Error('INVALID_GOAL_TEXT');
    await request(hostId, 'thread/goal/set', { threadId, origin: 'user', objective });
    await refreshGoal(hostId, threadId);
  }, [refreshGoal, request]);
  const clearGoal = useCallback(async (hostId: HostId, threadId: string) => {
    await request(hostId, 'thread/goal/clear', { threadId, origin: 'user' });
    setGoals((g) => ({ ...g, [threadKey(hostId, threadId)]: null }));
  }, [request]);
  const continueGoal = useCallback(async (hostId: HostId, threadId: string) => {
    await request(hostId, 'thread/goal/set', { threadId, origin: 'user', status: 'active' });
    await refreshGoal(hostId, threadId);
  }, [request, refreshGoal]);
  const deleteQueued = useCallback(async (hostId: HostId, threadId: string, id: string) => {
    await request(hostId, 'thread/queue/delete', { threadId, queuedSubmissionId: id });
    await refreshQueue(hostId, threadId);
  }, [request, refreshQueue]);
  const replyApproval = useCallback((decision: 'accept' | 'decline') => {
    if (!approval) return;
    const client = clients.current.get(approval.hostId);
    if (!client?.ready || client.socket.readyState !== WebSocket.OPEN) throw Error('APPROVAL_CONNECTION_LOST');
    client.socket.send(JSON.stringify({ id: approval.id, result: { decision } }));
    setApproval(null);
  }, [approval]);

  return {
    prepareAttachments,
    status, errors, rateQuota, refreshRateQuota, quotaGuard, refreshQuotaGuard, setQuotaGuardEnabled,
    projects, conversations, models, permissions, threadPermissions, customPermissionChanged, approval, goals, queues,
    contextUsages, clearContextUsage, compactions, compactThread, recheckCompaction,
    listSideChats, createSideChat, loadSideChat, readSubAgent,
    request, select, refresh, forgetDeletedThread, readThread, refreshGoal, refreshQueue, readImage,
    readAssistantImage, readToolImage,
    send, interrupt, renameThread, moveThread, setThreadPermission, setThreadModel, forkThread, setGoal, clearGoal, continueGoal, deleteQueued, replyApproval,
  };
}
