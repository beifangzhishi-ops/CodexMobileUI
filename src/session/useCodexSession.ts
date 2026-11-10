import { useCallback, useEffect, useRef, useState } from 'react';
import type { Host } from '../core/host';
import { CodexTransport } from '../core/transport';
import { includeLiveThreads, listAllThreads } from '../core/threadApi';
import { listAllProjects, type CodexProject } from '../core/projectApi';
import {
  applyNotification, parseThreadSnapshotState, recordOf, type ChatMessage,
  type CodexNotice, type CodexThread,
} from '../core/protocol';
import { accessToken } from '../auth/tokens';
import {
  clearDraft, clearPendingSelection, loadMessages, loadPendingSelection, loadProjects, loadThreads,
  claimTitleJob, enqueueTitleJob, listTitleJobs, markPendingCreationAttempt,
  removeTitleJob, replaceMessages,
  savePendingSelection, storeDraft, storeProjects, storeThreads,
  type PendingSelectionRecord,
} from '../storage/database';
import { createPendingSelection, pendingDraftKey, sendFirstTurn } from './firstSend';
import { isolatedHostCacheKey } from '../storage/profile';
import { generateAutoTitle } from './titleGenerator';
import { logDiagnostic } from '../diagnostics/journal';
import { classifyDiagnosticError } from '../diagnostics/safe';

export type ConnectionStatus = 'offline' | 'connecting' | 'online';

export interface CodexSession {
  status: ConnectionStatus;
  threads: CodexThread[];
  projects: CodexProject[];
  activeThreadId: string | null;
  pending: PendingSelectionRecord | null;
  draftKey: string | null;
  messages: ChatMessage[];
  running: boolean;
  lastSynced: number | null;
  error: string | null;
  chooseThread: (id: string) => Promise<void>;
  createThread: (projectId: string | null, cwd: string | null) => Promise<void>;
  send: (text: string, expectedKey: string | null) => Promise<void>;
  moveThread: (id: string, projectId: string) => Promise<void>;
  renameThread: (id: string, name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const errorString = (value: unknown): string =>
  value instanceof Error ? value.message : '未知错误';

/** Codex owns all real thread history; phone state only tracks navigation and drafts. */
export function useCodexSession(host: Host | null): CodexSession {
  const [status, setStatus] = useState<ConnectionStatus>('offline');
  const [threads, setThreads] = useState<CodexThread[]>([]);
  const [projects, setProjects] = useState<CodexProject[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingSelectionRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = useRef<CodexTransport | null>(null);
  const active = useRef<string | null>(null);
  const pendingRef = useRef<PendingSelectionRecord | null>(null);
  const generation = useRef(0);
  const reconnect = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveThreads = useRef(new Map<string, CodexThread>());
  const sending = useRef<Promise<void> | null>(null);
  const uncertainCreation = useRef<string | null>(null);
  const moved = useRef(new Map<string, string>());
  const manualNames = useRef(new Set<string>());
  const naming = useRef(new Set<string>());
  const completedEarly = useRef(new Set<string>());

  const reconcileThreads = useCallback((list: CodexThread[]) => {
    for (const thread of list) {
      liveThreads.current.delete(thread.id);
      const expected = moved.current.get(thread.id);
      if (expected !== undefined && thread.projectId !== expected) {
        moved.current.delete(thread.id);
        setError('会话项目归属已变化：请刷新 MobileUI 项目列表核对当前状态');
      }
    }
    setThreads(includeLiveThreads(list, liveThreads.current));
  }, []);

  const readThread = useCallback(async (id: string, source?: CodexTransport) => {
    const connection = source ?? client.current;
    if (!host || !connection?.connected) return;
    const selection = ++generation.current;
    const startedAt = Date.now();
    logDiagnostic('session.threadReadStarted');
    const raw = await connection.request('thread/read', { threadId: id, includeTurns: true });
    const snapshot = parseThreadSnapshotState(raw, id);
    logDiagnostic('session.threadReadFinished', {
      count: snapshot.messages.length, durationMs: Date.now() - startedAt,
      inProgress: snapshot.running,
    });
    if (client.current !== connection) return;
    if (!snapshot.running) await replaceMessages(isolatedHostCacheKey(host.id), id, snapshot.messages);
    if (selection === generation.current && active.current === id) {
      setMessages(snapshot.messages);
      setRunning(snapshot.running);
      if (!snapshot.running) setLastSynced(Date.now());
    }
  }, [host]);

  const chooseThread = useCallback(async (id: string) => {
    if (!host) return;
    logDiagnostic('session.threadSelected');
    const oldPending = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (oldPending) void clearPendingSelection(isolatedHostCacheKey(host.id), oldPending.id);
    active.current = id;
    setActiveThreadId(id);
    const selection = ++generation.current;
    setRunning(false);
    const cached = await loadMessages(isolatedHostCacheKey(host.id), id);
    logDiagnostic('session.cachedMessagesLoaded', { cacheCount: cached.length });
    if (selection !== generation.current || active.current !== id) return;
    setMessages(cached);
    const connection = client.current;
    if (liveThreads.current.has(id)) return; // Not yet persisted, resume/read can fail.
    if (connection?.connected) {
      try {
        await connection.request('thread/resume', { threadId: id });
        if (selection !== generation.current || active.current !== id ||
            client.current !== connection) return;
        await readThread(id, connection);
      } catch (e) {
        logDiagnostic('session.threadResumeFailed', classifyDiagnosticError(e));
        if (client.current === connection) setError(errorString(e));
      }
    }
  }, [host, readThread]);

  const fetchProjects = useCallback(async (connection: CodexTransport, hostId: string) => {
    const list = await listAllProjects(connection);
    if (client.current !== connection) return;
    setProjects(list);
    await storeProjects(hostId, list);
  }, []);

  const maybeName = useCallback(async (threadId: string, connection: CodexTransport) => {
    if (!host || client.current !== connection || naming.current.has(threadId)) return;
    naming.current.add(threadId);
    try {
      const job = (await listTitleJobs(isolatedHostCacheKey(host.id))).find((row) => row.threadId === threadId);
      if (!job || manualNames.current.has(threadId)) return;
      const raw = recordOf(await connection.request('thread/read', {
        threadId, includeTurns: true,
      }));
      const thread = recordOf(raw.thread);
      if (thread.name) {
        await removeTitleJob(isolatedHostCacheKey(host.id), threadId);
        return;
      }
      const snapshot = parseThreadSnapshotState(raw, threadId);
      if (snapshot.running || !snapshot.messages.some((m) => m.role === 'assistant')) return;
      if (!await claimTitleJob(isolatedHostCacheKey(host.id), threadId)) return;
      const response = snapshot.messages.filter((m) => m.role === 'assistant').at(-1)?.text ?? '';
      const title = await generateAutoTitle(
        connection, threadId, job.cwd, job.firstMessage, response,
        () => client.current === connection && !manualNames.current.has(threadId),
      );
      if (title) await removeTitleJob(isolatedHostCacheKey(host.id), threadId);
    } catch {
      // The bounded local job persists for a later retry without blocking chat.
    } finally {
      naming.current.delete(threadId);
    }
  }, [host]);

  const refresh = useCallback(async () => {
    const connection = client.current;
    if (!host || !connection?.connected) return;
    logDiagnostic('session.refreshStarted');
    const list = await listAllThreads(connection);
    if (client.current !== connection) return;
    await storeThreads(isolatedHostCacheKey(host.id), list);
    if (client.current !== connection) return;
    reconcileThreads(list);
    logDiagnostic('session.refreshFinished', { count: list.length });
    try { await fetchProjects(connection, isolatedHostCacheKey(host.id)); }
    catch (e) { if (client.current === connection) setError('项目同步失败：' + errorString(e)); }
    if (active.current && !liveThreads.current.has(active.current)) {
      await readThread(active.current, connection);
    }
    for (const job of await listTitleJobs(isolatedHostCacheKey(host.id))) {
      void maybeName(job.threadId, connection);
    }
  }, [host, reconcileThreads, fetchProjects, readThread, maybeName]);

  useEffect(() => {
    const currentHost = host;
    logDiagnostic('session.hostEffectStarted', { codePresent: Boolean(currentHost) });
    setStatus('offline');
    setThreads([]);
    setProjects([]);
    setMessages([]);
    setError(null);
    active.current = null;
    pendingRef.current = null;
    liveThreads.current.clear();
    moved.current.clear();
    uncertainCreation.current = null;
    setActiveThreadId(null);
    setPending(null);
    generation.current++;
    if (!currentHost) return;

    let alive = true;
    let retry = 0;
    const handleNotice = (notice: CodexNotice) => {
      if (!alive) return;
      const threadId = active.current;
      if (threadId) {
        const noticeThread = notice.params.threadId ?? recordOf(notice.params.thread).id;
        if (noticeThread === threadId) {
          if (notice.method === 'turn/started') setRunning(true);
          if (notice.method === 'turn/completed') {
            setRunning(false);
            completedEarly.current.add(threadId);
            void readThread(threadId).then(() => {
              if (liveThreads.current.has(threadId)) void refresh().catch(() => undefined);
              if (client.current) void maybeName(threadId, client.current);
            }).catch((e) => { if (alive) setError(errorString(e)); });
          }
          if (notice.method === 'item/completed' || notice.method === 'item/agentMessage/delta') {
            setMessages((old) => applyNotification(old, notice, threadId));
          }
        }
      }
      if (notice.method === 'thread/started' || notice.method === 'thread/name/updated' ||
          notice.method === 'thread/project/updated') {
        const connection = client.current;
        if (connection?.connected) {
          void listAllThreads(connection).then((list) => {
            if (!alive || client.current !== connection) return;
            reconcileThreads(list);
            void storeThreads(isolatedHostCacheKey(currentHost.id), list);
          }).catch(() => undefined);
        }
      }
      if (notice.method.startsWith('project/')) {
        const connection = client.current;
        if (connection?.connected) {
          void fetchProjects(connection, isolatedHostCacheKey(currentHost.id)).catch(() => undefined);
        }
      }
    };

    const scheduleReconnect = () => {
      if (!alive || reconnect.current !== null) return;
      setStatus('offline');
      setRunning(false);
      retry++;
      logDiagnostic('session.reconnectScheduled', { retry });
      reconnect.current = setTimeout(() => {
        reconnect.current = null;
        void establish();
      }, Math.min(20_000, 1000 * 2 ** Math.min(retry, 4)));
    };

    const establish = async () => {
      if (!alive) return;
      setStatus('connecting');
      logDiagnostic('session.connecting');
      try {
        const token = await accessToken(currentHost);
        if (!alive) return;
        client.current?.close();
        const connection = new CodexTransport(currentHost, token);
        client.current = connection;
        connection.subscribe(handleNotice);
        connection.setDisconnectListener(scheduleReconnect);
        await connection.connect();
        if (!alive) return;
        retry = 0;
        setStatus('online');
        logDiagnostic('session.online');
        setError(null);
        const list = await listAllThreads(connection);
        if (!alive || client.current !== connection) return;
        logDiagnostic('session.threadsReceived', { count: list.length });
        reconcileThreads(list);
        void storeThreads(isolatedHostCacheKey(currentHost.id), list);
        try { await fetchProjects(connection, isolatedHostCacheKey(currentHost.id)); }
        catch (e) { if (alive) setError('项目同步失败：' + errorString(e)); }
        for (const job of await listTitleJobs(isolatedHostCacheKey(currentHost.id))) {
          void maybeName(job.threadId, connection);
        }
        const selected = pendingRef.current ? null : (active.current ?? list[0]?.id ?? null);
        if (selected) {
          active.current = selected;
          setActiveThreadId(selected);
          if (!liveThreads.current.has(selected)) {
            await connection.request('thread/resume', { threadId: selected });
            await readThread(selected, connection);
          }
        }
      } catch (e) {
        logDiagnostic('session.connectFailed', classifyDiagnosticError(e));
        if (!alive) return;
        setError(errorString(e));
        client.current?.close();
        scheduleReconnect();
      }
    };

    void (async () => {
      try {
        logDiagnostic('session.cacheLoadStarted');
        const cached = await loadThreads(isolatedHostCacheKey(currentHost.id));
        if (!alive) return;
        logDiagnostic('session.cacheLoadFinished', { cacheCount: cached.length });
        setThreads(cached);
        setProjects(await loadProjects(isolatedHostCacheKey(currentHost.id)));
        const saved = await loadPendingSelection(isolatedHostCacheKey(currentHost.id));
        if (!alive) return;
        if (saved && !active.current && !pendingRef.current) {
          pendingRef.current = saved;
          setPending(saved);
        } else if (!active.current && !pendingRef.current && cached[0]) {
          const id = cached[0].id;
          active.current = id;
          setActiveThreadId(id);
          const select = ++generation.current;
          const cachedMessages = await loadMessages(isolatedHostCacheKey(currentHost.id), id);
          if (alive && active.current === id && select === generation.current) {
            setMessages(cachedMessages);
          }
        }
      } catch (e) {
        logDiagnostic('session.cacheLoadFailed', classifyDiagnosticError(e));
        if (alive) setError(errorString(e));
      }
      if (alive) await establish();
    })();

    return () => {
      alive = false;
      logDiagnostic('session.hostEffectStopped');
      if (reconnect.current) {
        clearTimeout(reconnect.current);
        reconnect.current = null;
      }
      client.current?.close();
      client.current = null;
    };
  }, [host?.id, readThread, reconcileThreads, fetchProjects, refresh, maybeName]);

  const createThread = useCallback(async (projectId: string | null, cwd: string | null) => {
    if (!host) throw new Error('请先选择电脑');
    const selection = createPendingSelection(projectId, cwd);
    logDiagnostic('session.createThreadStarted');
    pendingRef.current = selection;
    setPending(selection);
    active.current = null;
    generation.current++;
    setActiveThreadId(null);
    setMessages([]);
    setRunning(false);
    setError(null);
    uncertainCreation.current = null;
    await savePendingSelection(isolatedHostCacheKey(host.id), selection);
    logDiagnostic('session.createThreadFinished');
  }, [host]);

  const send = useCallback(async (text: string, expectedKey: string | null) => {
    logDiagnostic('session.sendPressed', { codePresent: Boolean(text.trim()) });
    if (!text.trim()) return;
    const selection = pendingRef.current;
    const currentId = active.current;
    const key = selection ? pendingDraftKey(selection) : currentId;
    if (!key || key !== expectedKey) throw new Error('已切换会话，请重新确认发送');
    if (!host || !client.current?.connected) throw new Error('离线时只能保存草稿，不会自动发送');
    if (sending.current) throw new Error('上一条消息仍在提交，请勿重复发送');
    if (selection && (selection.creationUncertain || uncertainCreation.current === selection.id)) {
      throw new Error('创建会话结果不明，请先核对电脑端历史，不要重复创建');
    }
    const connection = client.current;
    const task = (async () => {
      const created = { value: null as CodexThread | null };
      let attemptedCreate = false;
      logDiagnostic('session.sendStarted');
      const promote = async (thread: CodexThread, accepted: boolean) => {
        await storeDraft(isolatedHostCacheKey(host.id), thread.id, accepted ? '' : text).catch(() => undefined);
        void clearPendingSelection(isolatedHostCacheKey(host.id), selection?.id);
        if (selection) void clearDraft(isolatedHostCacheKey(host.id), pendingDraftKey(selection));
        if (client.current !== connection || pendingRef.current?.id !== selection?.id) {
          await storeThreads(isolatedHostCacheKey(host.id), [thread]);
          return;
        }
        pendingRef.current = null;
        setPending(null);
        if (active.current !== thread.id) generation.current++;
        active.current = thread.id;
        setActiveThreadId(thread.id);
        // Notifications may precede turn/start's RPC response. Keep deltas
        // already received for this new thread and do not re-mark a completed
        // turn as running.
        setRunning(accepted && !completedEarly.current.has(thread.id));
        completedEarly.current.delete(thread.id);
        liveThreads.current.set(thread.id, thread);
        setThreads((previous) => includeLiveThreads(previous, liveThreads.current));
      };
      try {
        if (selection) {
          await sendFirstTurn(connection, selection, text, async (thread) => {
            created.value = thread;
            // The callback is before turn/start; preserve the ID even on failure.
            await storeDraft(isolatedHostCacheKey(host.id), thread.id, text).catch(() => undefined);
            if (client.current === connection && pendingRef.current?.id === selection.id) {
              active.current = thread.id;
            }
          }, async () => {
            attemptedCreate = true;
            // No automatic second thread even if the app dies in this window.
            await markPendingCreationAttempt(isolatedHostCacheKey(host.id), selection.id);
          });
          if (created.value) {
            await enqueueTitleJob(isolatedHostCacheKey(host.id), created.value.id, created.value.cwd ?? '', text).catch(() => undefined);
            await promote(created.value, true);
            void maybeName(created.value.id, connection);
          }
        } else {
          await connection.request('turn/start', {
            threadId: currentId, input: [{ type: 'text', text }],
          });
        }
        logDiagnostic('session.sendAccepted');
      } catch (e) {
        if (created.value) await promote(created.value, false);
        else if (selection && attemptedCreate && pendingRef.current?.id === selection.id) {
          uncertainCreation.current = selection.id;
        }
        logDiagnostic('session.sendFailed', classifyDiagnosticError(e));
        if (client.current === connection) {
          setError('发送状态未确认。请核对电脑端会话，避免重复发送：' + errorString(e));
          const inspectId = created.value ? created.value.id : currentId;
          if (inspectId) void readThread(inspectId, connection).catch(() => undefined);
        }
        throw e;
      }
    })();
    sending.current = task;
    try { await task; }
    finally { if (sending.current === task) sending.current = null; }
  }, [host, readThread, maybeName]);

  const moveThread = useCallback(async (id: string, projectId: string) => {
    const connection = client.current;
    if (!host || !connection?.connected) throw new Error('电脑当前离线');
    if (!projects.some((project) => project.id === projectId)) {
      throw new Error('目标项目不存在，请刷新项目列表');
    }
    const raw = recordOf(await connection.request('thread/metadata/update', {
      threadId: id, projectId,
    }));
    if (recordOf(raw.thread).projectId !== projectId) {
      throw new Error('服务端没有确认会话归属变更');
    }
    moved.current.set(id, projectId);
    await refresh();
  }, [host, projects, refresh]);

  const renameThread = useCallback(async (id: string, name: string) => {
    const connection = client.current;
    if (!host || !connection?.connected) throw new Error('电脑当前离线');
    const title = name.replace(/\s+/g, ' ').trim();
    if (!title || Array.from(title).length > 80) throw new Error('标题长度必须为 1～80 字符');
    manualNames.current.add(id);
    try {
      await connection.request('thread/name/set', { threadId: id, name: title });
      await refresh();
    } catch (e) {
      manualNames.current.delete(id);
      throw e;
    }
  }, [host, refresh]);

  return {
    status, threads, projects, activeThreadId, pending,
    draftKey: pending ? pendingDraftKey(pending) : activeThreadId,
    messages, running, lastSynced, error, chooseThread, createThread,
    send, moveThread, renameThread, refresh,
  };
}
