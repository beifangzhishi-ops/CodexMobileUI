import { useCallback, useEffect, useRef, useState } from 'react';
import type { Host } from '../core/host';
import { CodexTransport } from '../core/transport';
import { includeLiveThreads, listAllThreads, startLiveThread } from '../core/threadApi';
import {
  applyNotification, parseThreadSnapshotState, recordOf,
  type ChatMessage, type CodexNotice, type CodexThread,
} from '../core/protocol';
import { accessToken } from '../auth/tokens';
import {
  loadMessages, loadThreads, replaceMessages, storeThreads,
} from '../storage/database';
import { logDiagnostic } from '../diagnostics/journal';
import { classifyDiagnosticError } from '../diagnostics/safe';

export type ConnectionStatus = 'offline' | 'connecting' | 'online';

export interface CodexSession {
  status: ConnectionStatus;
  threads: CodexThread[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  running: boolean;
  lastSynced: number | null;
  error: string | null;
  chooseThread: (id: string) => Promise<void>;
  createThread: (cwd: string | null) => Promise<void>;
  send: (text: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const errorString = (value: unknown): string =>
  value instanceof Error ? value.message : '未知错误';

/**
 * Codex App Server remains the only writer and history authority.
 * SQLite is only a materialized cache of confirmed server turns/items.
 */
export function useCodexSession(host: Host | null): CodexSession {
  const [status, setStatus] = useState<ConnectionStatus>('offline');
  const [threads, setThreads] = useState<CodexThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useRef<CodexTransport | null>(null);
  const active = useRef<string | null>(null);
  const generation = useRef(0);
  const reconnect = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveThreads = useRef(new Map<string, CodexThread>());
  const pendingCreate = useRef<Promise<void> | null>(null);

  const reconcileThreadList = useCallback((list: CodexThread[]) => {
    for (const thread of list) liveThreads.current.delete(thread.id);
    setThreads(includeLiveThreads(list, liveThreads.current));
  }, []);

  const readThread = useCallback(async (id: string, source?: CodexTransport) => {
    if (!host) return;
    const connection = source ?? client.current;
    if (!connection?.connected) return;
    const sequence = ++generation.current;
    const startedAt = Date.now();
    logDiagnostic('session.threadReadStarted');
    const raw = await connection.request('thread/read', { threadId: id, includeTurns: true });
    const snapshot = parseThreadSnapshotState(raw, id);
    logDiagnostic('session.threadReadFinished', {
      count: snapshot.messages.length, durationMs: Date.now() - startedAt,
      inProgress: snapshot.running,
    });
    if (sequence !== generation.current) return;
    // Never persist partially generated assistant text as finalized history.
    // An active turn becomes authoritative only on a completed snapshot.
    if (!snapshot.running) await replaceMessages(host.id, id, snapshot.messages);
    if (active.current === id && sequence === generation.current) {
      setMessages(snapshot.messages);
      setRunning(snapshot.running);
      if (!snapshot.running) setLastSynced(Date.now());
    }
  }, [host]);

  const chooseThread = useCallback(async (id: string) => {
    if (!host) return;
    logDiagnostic('session.threadSelected');
    active.current = id;
    setActiveThreadId(id);
    const selection = ++generation.current;
    setRunning(false);
    const cached = await loadMessages(host.id, id);
    logDiagnostic('session.cachedMessagesLoaded', { cacheCount: cached.length });
    if (active.current !== id || generation.current !== selection) return;
    setMessages(cached);
    const connection = client.current;
    // Empty new threads are live on this connection but may have no
    // persisted rollout for thread/resume and thread/read yet.
    if (liveThreads.current.has(id)) return;
    if (connection?.connected) {
      try {
        await connection.request('thread/resume', { threadId: id });
        if (active.current !== id || generation.current !== selection ||
            client.current !== connection) return;
        await readThread(id, connection);
      } catch (e) {
        logDiagnostic('session.threadResumeFailed', classifyDiagnosticError(e));
        if (client.current === connection) setError(errorString(e));
      }
    }
  }, [host, readThread]);

  const refresh = useCallback(async () => {
    const connection = client.current;
    if (!host || !connection?.connected) return;
    logDiagnostic('session.refreshStarted');
    const list = await listAllThreads(connection);
    logDiagnostic('session.refreshFinished', { count: list.length });
    if (client.current !== connection) return;
    await storeThreads(host.id, list);
    if (client.current !== connection) return;
    reconcileThreadList(list);
    if (active.current && !liveThreads.current.has(active.current)) {
      await readThread(active.current);
    }
  }, [host, readThread, reconcileThreadList]);

  useEffect(() => {
    const currentHost = host;
    logDiagnostic('session.hostEffectStarted', { codePresent: Boolean(currentHost) });
    setStatus('offline');
    setThreads([]);
    setMessages([]);
    setError(null);
    active.current = null;
    liveThreads.current.clear();
    setActiveThreadId(null);
    generation.current++;
    if (!currentHost) return;

    let retry = 0;
    let alive = true;
    const handleNotice = (notice: CodexNotice) => {
      if (!alive) return;
      const threadId = active.current;
      if (threadId) {
        const p = notice.params;
        const eventThread = p.threadId ?? recordOf(p.thread).id;
        if (eventThread === threadId) {
          if (notice.method === 'turn/started') setRunning(true);
          if (notice.method === 'turn/completed') {
            setRunning(false);
            void readThread(threadId).then(() => {
              if (liveThreads.current.has(threadId)) void refresh().catch((e) => {
                if (alive) setError(errorString(e));
              });
            }).catch((e) => { if (alive) setError(errorString(e)); });
          }
          if (notice.method === 'item/completed' ||
              notice.method === 'item/agentMessage/delta') {
            setMessages((old) => applyNotification(old, notice, threadId));
          }
        }
      }
      if (notice.method === 'thread/started' || notice.method === 'thread/name/updated') {
        // A thread may have been created by Desktop or AOI.
        if (!client.current) return;
        void listAllThreads(client.current)
          .then((list) => {
            if (!alive) return;
            reconcileThreadList(list);
            void storeThreads(currentHost.id, list);
          }).catch(() => undefined);
      }
    };

    const scheduleReconnect = () => {
      if (!alive) return;
      if (reconnect.current !== null) return;
      setStatus('offline');
      setRunning(false);
      retry++;
      logDiagnostic('session.reconnectScheduled', { retry });
      reconnect.current = setTimeout(() => {
        reconnect.current = null;
        void establish();
      },
        Math.min(20_000, 1000 * 2 ** Math.min(retry, 4)));
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
        logDiagnostic('session.threadsReceived', { count: list.length });
        if (!alive) return;
        reconcileThreadList(list);
        void storeThreads(currentHost.id, list);
        const selected = active.current ?? list[0]?.id ?? null;
        if (selected) {
          active.current = selected;
          setActiveThreadId(selected);
          await connection.request('thread/resume', { threadId: selected });
          await readThread(selected, connection);
        }
      } catch (e) {
        logDiagnostic('session.connectFailed', classifyDiagnosticError(e));
        if (!alive) return;
        setError(errorString(e));
        if (client.current) client.current.close();
        scheduleReconnect();
      }
    };

    void (async () => {
      try {
        logDiagnostic('session.cacheLoadStarted');
        const cached = await loadThreads(currentHost.id);
        logDiagnostic('session.cacheLoadFinished', { cacheCount: cached.length });
        if (!alive) return;
        setThreads(cached);
        if (cached[0]) {
          const cachedId = cached[0].id;
          active.current = cachedId;
          setActiveThreadId(cachedId);
          const selection = ++generation.current;
          const cachedMessages = await loadMessages(currentHost.id, cachedId);
          if (alive && active.current === cachedId && generation.current === selection) {
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
      logDiagnostic('session.hostEffectStopped');
      alive = false;
      if (reconnect.current) {
        clearTimeout(reconnect.current);
        reconnect.current = null;
      }
      client.current?.close();
      client.current = null;
    };
  }, [host?.id, readThread, reconcileThreadList, refresh]);

  const createThread = useCallback((cwd: string | null): Promise<void> => {
    if (pendingCreate.current) return pendingCreate.current;
    // Rapid duplicate taps must not create multiple invisible empty threads.
    if (active.current && liveThreads.current.has(active.current)) return Promise.resolve();
    const task = (async () => {
      logDiagnostic('session.createThreadStarted');
      const connection = client.current;
      if (!connection?.connected) throw new Error('当前无法新建会话：电脑离线');
      const thread = await startLiveThread(connection, cwd);
      if (client.current !== connection) {
        throw new Error('会话已在原电脑创建。请切换回原电脑核对，不要重复创建');
      }
      liveThreads.current.set(thread.id, thread);
      active.current = thread.id;
      generation.current++;
      setActiveThreadId(thread.id);
      setMessages([]);
      setRunning(false);
      setError(null);
      setThreads((previous) => includeLiveThreads(previous, liveThreads.current));
      logDiagnostic('session.createThreadFinished');
    })();
    pendingCreate.current = task;
    void task.finally(() => {
      if (pendingCreate.current === task) pendingCreate.current = null;
    }).catch(() => undefined);
    return task;
  }, []);

  const send = useCallback(async (text: string) => {
    logDiagnostic('session.sendPressed', { codePresent: Boolean(text.trim()) });
    const id = active.current;
    const connection = client.current;
    if (!id || !connection?.connected) throw new Error('离线时只能保存草稿，不会自动发送');
    if (!text.trim()) return;
    setError(null);
    try {
      logDiagnostic('session.sendStarted');
      await connection.request('turn/start', {
        threadId: id, input: [{ type: 'text', text }],
      });
      logDiagnostic('session.sendAccepted');
      // A successful RPC only means Codex accepted the turn. Do not read a
      // mid-turn snapshot here: a partially materialized agentMessage could
      // replace live text deltas and make streaming appear frozen. User/agent
      // items arrive over native events; the final turn/completed event then
      // reconciles and persists the authoritative thread snapshot.
    } catch (e) {
      logDiagnostic('session.sendFailed', classifyDiagnosticError(e));
      setError('发送状态未确认。请先核对电脑端会话，再决定是否重发。' + errorString(e));
      if (client.current === connection) {
        void readThread(id, connection).catch(() => undefined);
      }
      throw e;
    }
  }, [readThread]);

  return { status, threads, activeThreadId, messages, running, lastSynced,
    error, chooseThread, createThread, send, refresh };
}
