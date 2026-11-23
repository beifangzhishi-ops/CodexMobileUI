import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, HostId, Message } from './types';
import {
  applyNotice, obj, parseGoal, parseModels, parsePermissions, parseProjects, parseQueue,
  parseSnapshot, parseThreads, text, threadPreviewTitle,
} from './nativeProtocol';
import type { NativeGoal, NativeModel, NativePermission, NativeProject, NativeQueueEntry } from './nativeProtocol';
import { localMessageId } from './browserHelpers';
import type { NativeMention } from '../../shared/mentions';
import { parseContextWindowUsage, type ContextWindowUsage } from '../../shared/contextUsage';
import { parseRateQuota, type RateQuota } from '../../shared/rateLimits';
import { desktopFileMessage } from '../../shared/desktopFileReferences';
import { uploadDocument } from './documentUpload';
import { hasAbsolutePaths, type PathHosts } from './pathHosts';
import { displayOriginalPaths, readPathOverlays, storePathOverlay, type PathChange } from './pathOverlays';
import { desktopBridge } from './desktopBridge';

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
  const [projects, setProjects] = useState<NativeProject[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [models, setModels] = useState<Record<HostId, NativeModel[]>>({ '6v': [], noha: [] });
  const [permissions, setPermissions] = useState<Record<HostId, NativePermission[]>>({ '6v': [], noha: [] });
  const [threadPermissions, setThreadPermissions] = useState<Record<string, PermissionMode>>({});
  const [goals, setGoals] = useState<Record<string, NativeGoal | null>>({});
  const [queues, setQueues] = useState<Record<string, NativeQueueEntry[]>>({});
  const [contextUsages, setContextUsages] = useState<Record<string, ContextWindowUsage>>({});
  const waitingForModelTurn = useRef(new Set<string>());
  const [approval, setApproval] = useState<Approval | null>(null);
  const clients = useRef(new Map<HostId, Client>());
  const active = useRef<{ hostId: HostId; threadId: string } | null>(null);
  // Keep an explicitly chosen config-based mode across in-page navigation,
  // even when config.toml resolves to the same named profile as a preset.
  const permissionSelections = useRef(new Map<string, {
    mode: PermissionMode; profile: string | null; reviewer: string | null;
  }>());
  const permissionEpochs = useRef(new Map<string, number>());
  const changed = useRef(new Map<string, number>());
  // A very fast model can finish before the turn/start acknowledgement is
  // processed. Never revive a completed turn as "running" on late ack.
  const completedTurnIds = useRef(new Map<string, string>());
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
        return old ? { ...item, messages: old.messages, localCreated: false,
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
        item.localCreated && (item.running || Date.now() - item.updatedAt < 10 * 60_000));
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
    snapshot.messages = displayOriginalPaths(snapshot.messages, overlays);
    if (eventVersion !== (changed.current.get(key) ?? 0)) {
      // Do not overwrite newer streaming messages with an older asynchronous read.
      return snapshot.messages;
    }
    setConversations((all) => all.map((item) => {
      if (item.hostId !== hostId || item.id !== threadId) return item;
      const liveError = snapshot.activeTurnId && item.messages.find((message) =>
        message.kind === 'turnError' && message.turnId === snapshot.activeTurnId);
      const messages = liveError ? [...snapshot.messages, liveError] : snapshot.messages;
      return { ...item, ...snapshot, messages, status: snapshot.running ? 'running' : 'idle', syncPending: false };
    }));
    return snapshot.messages;
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

  const select = useCallback(async (hostId: HostId, threadId: string) => {
    active.current = { hostId, threadId };
    const messages = await readThread(hostId, threadId);
    const key = threadKey(hostId, threadId);
    const epoch = permissionEpochs.current.get(key) ?? 0;
    void request(hostId, 'thread/resume', { threadId }).then((result) => {
      if ((permissionEpochs.current.get(key) ?? 0) !== epoch) return;
      const resumed = obj(result);
      const profile = text(obj(resumed.activePermissionProfile).id) || null;
      const reviewer = text(resumed.approvalsReviewer) || null;
      if (!profile && !reviewer) return;
      const inferred: PermissionMode = profile === ':workspace' ? (reviewer === 'auto_review' ? 'auto-review' : 'default') :
        profile === ':read-only' ? 'read-only' : profile === ':danger-full-access' ? 'full-access' : 'custom';
      const selected = permissionSelections.current.get(key);
      const mode = selected && selected.profile === profile && selected.reviewer === reviewer
        ? selected.mode : inferred;
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
          if (frame.method === 'thread/tokenUsage/updated') {
            const usage = parseContextWindowUsage(params.tokenUsage);
            if (usage && !waitingForModelTurn.current.has(key))
              setContextUsages((all) => ({ ...all, [key]: usage }));
            return; // Usage notifications do not invalidate concurrent message snapshots.
          }
          if (frame.method === 'thread/deleted') forgetDeletedThread(hostId, threadId);
          if (frame.method === 'turn/started') waitingForModelTurn.current.delete(key);
          changed.current.set(key, (changed.current.get(key) ?? 0) + 1);
          if (frame.method === 'turn/started') {
            const turn = obj(params.turn);
            setConversations((all) => all.map((c) => c.hostId === hostId && c.id === threadId
              ? { ...c, status: 'running', running: true, syncPending: false,
                activeTurnId: text(turn.id) || c.activeTurnId, runningSinceMs: typeof turn.startedAt === 'number' ? turn.startedAt * 1000 : Date.now() } : c));
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
          if (frame.method === 'turn/completed' && active.current?.hostId === hostId && active.current.threadId === threadId) {
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
  }, [refresh, refreshGoal, readThread, refreshQueue, request, select, refreshRateQuota]);

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
      const response = obj(await request(hostId, 'web/start', { projectId, ...nativePerms }, 30_000));
      threadId = text(obj(response.thread).id);
      if (!threadId) throw Error('THREAD_START_UNCONFIRMED');
      const id = threadId;
      setConversations((current) => current.some((c) => c.id === id && c.hostId === hostId) ? current : [{
        id, hostId, project: projectId, archived: false,
        title: threadPreviewTitle(goalOnly ? options.goal! : messageText),
        status: 'idle', running: false, activeTurnId: null, localCreated: true,
        updatedAt: Date.now(), messages: [],
      }, ...current]);
      active.current = { hostId, threadId: id };
      options.onCreated?.(id);
    } else {
      await request(hostId, 'thread/resume', { threadId });
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
    const response = running
      ? obj(await request(hostId, 'turn/steer', { threadId: id,
        input: nativeInput, expectedTurnId: currentThread!.activeTurnId }, 30_000))
      : obj(await request(hostId, 'turn/start', { threadId: id,
        input: nativeInput, ...settings }, 30_000));
    const nativeTurnId = running ? text(response.turnId) || currentThread!.activeTurnId! : text(obj(response.turn).id);
    if (!nativeTurnId) throw Error('TURN_UNCONFIRMED');
    if (pathChanges.length) {
      // Metadata is optional and never retriggers an already accepted native turn.
      void storePathOverlay({ hostId, threadId: id, turnId: nativeTurnId,
        changes: pathChanges }).catch(() => undefined);
    }
    options.onAccepted?.(id, nativeTurnId, running);
    const alreadyCompleted = completedTurnIds.current.get(threadKey(hostId, id)) === nativeTurnId;
    setConversations((all) => all.map((item) => item.hostId === hostId && item.id === id ? {
      ...item, status: alreadyCompleted ? 'idle' : 'running',
      running: !alreadyCompleted, syncPending: false,
      activeTurnId: alreadyCompleted ? null : nativeTurnId,
      runningSinceMs: alreadyCompleted ? null : item.runningSinceMs ?? Date.now(),
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
  }, [models, permissions, conversations, request, readThread, refreshGoal, refreshQueue, status, prepareAttachments]);

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
      permissionSelections.current.set(key, {
        mode, profile: text(applied.profile) || null, reviewer: text(applied.reviewer),
      });
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
    setThreadPermissions((all) => ({ ...all, [key]: mode }));
  }, [permissions, request]);

  const forkThread = useCallback(async (hostId: HostId, threadId: string, lastTurnId: string) => {
    const original = conversations.find((c) => c.hostId === hostId && c.id === threadId);
    if (!original || !original.messages.some((m) => m.turnId === lastTurnId && m.role === 'assistant' &&
        !m.kind && ['completed', 'interrupted', 'failed'].includes(m.turnStatus ?? ''))) {
      throw Error('TURN_NOT_COMPLETE');
    }
    const response = obj(await request(hostId, 'thread/fork', {
      threadId, lastTurnId, excludeTurns: true,
    }, 90_000));
    const fork = obj(response.thread);
    const newId = text(fork.id);
    if (!newId || newId === threadId) throw Error('FORK_NOT_CONFIRMED');
    setConversations((all) => all.some((c) => c.id === newId && c.hostId === hostId) ? all : [{
      id: newId, hostId, project: text(fork.projectId) || original.project,
      title: text(fork.name) || original.title, status: 'idle', running: false,
      activeTurnId: null, localCreated: true, updatedAt: Date.now(), messages: [],
    }, ...all]);
    await select(hostId, newId);
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
    status, errors, rateQuota, refreshRateQuota,
    projects, conversations, models, permissions, threadPermissions, approval, goals, queues,
    contextUsages, clearContextUsage,
    request, select, refresh, forgetDeletedThread, readThread, refreshGoal, refreshQueue, readImage,
    readAssistantImage, readToolImage,
    send, interrupt, renameThread, setThreadPermission, forkThread, setGoal, clearGoal, continueGoal, deleteQueued, replyApproval,
  };
}
