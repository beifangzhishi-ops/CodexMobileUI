import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation, HostId, Message } from './types';
import {
  applyNotice, obj, parseGoal, parseModels, parsePermissions, parseProjects, parseQueue,
  parseSnapshot, parseThreads, text,
} from './nativeProtocol';
import type { NativeGoal, NativeModel, NativePermission, NativeProject, NativeQueueEntry } from './nativeProtocol';
import { localMessageId } from './browserHelpers';

type Params = Record<string, unknown>;
type Frame = { id?: number; method?: string; params?: Params; result?: unknown; error?: { message?: string; code?: number }; type?: string };
type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: number };
type Client = { socket: WebSocket; pending: Map<number, Pending>; seq: number; ready: boolean };
type HostStatus = 'connecting' | 'online' | 'offline';
export type PermissionMode = 'default' | 'auto-review' | 'read-only' | 'full-access' | 'custom';
export type FollowUpMode = 'steer' | 'queue';
export type SendOptions = {
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  plan?: boolean;
  goal?: string;
  followUpMode?: FollowUpMode;
  onCreated?: (id: string) => void;
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
  const [projects, setProjects] = useState<NativeProject[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [models, setModels] = useState<Record<HostId, NativeModel[]>>({ '6v': [], noha: [] });
  const [permissions, setPermissions] = useState<Record<HostId, NativePermission[]>>({ '6v': [], noha: [] });
  const [goals, setGoals] = useState<Record<string, NativeGoal | null>>({});
  const [queues, setQueues] = useState<Record<string, NativeQueueEntry[]>>({});
  const [approval, setApproval] = useState<Approval | null>(null);
  const clients = useRef(new Map<HostId, Client>());
  const active = useRef<{ hostId: HostId; threadId: string } | null>(null);
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
      const pending = [...previous.values()].filter((item) => !byId.has(item.id) && !item.archived &&
        (item.localCreated || item.syncPending || item.running || item.messages.length > 0));
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

  const readThread = useCallback(async (hostId: HostId, threadId: string): Promise<Message[]> => {
    const key = threadKey(hostId, threadId);
    const eventVersion = changed.current.get(key) ?? 0;
    const snapshot = parseSnapshot(await request(hostId, 'thread/read', { threadId, includeTurns: true }), threadId);
    if (eventVersion !== (changed.current.get(key) ?? 0)) {
      // Do not overwrite newer streaming messages with an older asynchronous read.
      return snapshot.messages;
    }
    setConversations((all) => all.map((item) => item.hostId === hostId && item.id === threadId
      ? { ...item, ...snapshot, status: snapshot.running ? 'running' : 'idle', syncPending: false } : item));
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
    void refreshQueue(hostId, threadId).catch(() => undefined);
    void refreshGoal(hostId, threadId).catch(() => undefined);
    return messages;
  }, [readThread, refreshQueue, refreshGoal]);

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
          } else if (frame.method === 'item/started' || frame.method === 'item/completed' ||
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
    return () => {
      alive.current = false;
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
  }, [refresh, refreshGoal, readThread, refreshQueue, request, select]);

  const send = useCallback(async (hostId: HostId, existingId: string | null,
    projectId: string | null, value: string, options: SendOptions) => {
    const messageText = value.trim();
    if (!messageText || messageText.length > 12_000) throw Error('TEXT_REQUIRED_OR_TOO_LONG');
    if (status[hostId] !== 'online') throw Error('HOST_OFFLINE');
    const perm = options.permissionMode ?? 'default';
    const nativePerms = permissionParams(perm);
    const profile = permissionId(perm);
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
    let threadId = existingId;
    if (!threadId) {
      const response = obj(await request(hostId, 'web/start', { projectId, ...nativePerms }, 30_000));
      threadId = text(obj(response.thread).id);
      if (!threadId) throw Error('THREAD_START_UNCONFIRMED');
      const id = threadId;
      setConversations((current) => current.some((c) => c.id === id && c.hostId === hostId) ? current : [{
        id, hostId, project: projectId, archived: false, title: messageText.slice(0, 48),
        status: 'idle', running: false, activeTurnId: null, localCreated: true,
        updatedAt: Date.now(), messages: [],
      }, ...current]);
      active.current = { hostId, threadId: id };
      options.onCreated?.(id);
    } else {
      await request(hostId, 'thread/resume', { threadId });
    }
    const id = threadId;
    const currentThread = conversations.find((c) => c.id === id && c.hostId === hostId);
    if (options.followUpMode === 'queue' && existingId) {
      if (options.plan || options.goal) throw Error('QUEUE_TEXT_ONLY');
      const queued = obj(await request(hostId, 'thread/queue/add', {
        threadId: id, clientUserMessageId: localMessageId(),
        input: [{ type: 'text', text: messageText }],
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
        input: [{ type: 'text', text: messageText }], expectedTurnId: currentThread!.activeTurnId }, 30_000))
      : obj(await request(hostId, 'turn/start', { threadId: id,
        input: [{ type: 'text', text: messageText }], ...settings }, 30_000));
    const nativeTurnId = running ? text(response.turnId) || currentThread!.activeTurnId! : text(obj(response.turn).id);
    if (!nativeTurnId) throw Error('TURN_UNCONFIRMED');
    const alreadyCompleted = completedTurnIds.current.get(threadKey(hostId, id)) === nativeTurnId;
    setConversations((all) => all.map((item) => item.hostId === hostId && item.id === id ? {
      ...item, status: alreadyCompleted ? 'idle' : 'running',
      running: !alreadyCompleted, syncPending: false,
      activeTurnId: alreadyCompleted ? null : nativeTurnId,
      runningSinceMs: alreadyCompleted ? null : item.runningSinceMs ?? Date.now(),
      updatedAt: Date.now(),
      messages: item.messages.some((m) => m.role === 'user' && m.turnId === nativeTurnId && m.content === messageText)
        ? item.messages : [...item.messages, { id: localMessageId(), role: 'user', content: messageText,
          turnId: nativeTurnId, timestampMs: Date.now() }],
    } : item));
    // Reconcile the true server identity after the accepted turn. This also
    // replaces temporary user bubbles without leaving duplicate messages.
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
  }, [models, permissions, conversations, request, readThread, refreshGoal, refreshQueue, status]);

  const interrupt = useCallback(async (hostId: HostId, threadId: string) => {
    const item = conversations.find((entry) => entry.hostId === hostId && entry.id === threadId);
    if (!item?.activeTurnId) throw Error('NO_ACTIVE_TURN');
    await request(hostId, 'turn/interrupt', { threadId, turnId: item.activeTurnId });
    void readThread(hostId, threadId).catch(() => undefined);
  }, [conversations, readThread, request]);

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
    status, errors, projects, conversations, models, permissions, approval, goals, queues,
    request, select, refresh, readThread, refreshGoal, refreshQueue,
    send, interrupt, setGoal, clearGoal, continueGoal, deleteQueued, replyApproval,
  };
}
