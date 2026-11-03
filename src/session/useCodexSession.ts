import { useCallback, useEffect, useRef, useState } from 'react';
import type { Host } from '../core/host';
import { CodexTransport } from '../core/transport';
import {
  applyNotification, parseThreadList, parseThreadSnapshot, recordOf,
  type ChatMessage, type CodexNotice, type CodexThread,
} from '../core/protocol';
import { accessToken } from '../auth/tokens';
import {
  loadMessages, loadThreads, replaceMessages, storeThreads,
} from '../storage/database';

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
  const disposed = useRef(false);

  const readThread = useCallback(async (id: string, source?: CodexTransport) => {
    if (!host) return;
    const connection = source ?? client.current;
    if (!connection?.connected) return;
    const sequence = ++generation.current;
    const raw = await connection.request('thread/read', { threadId: id, includeTurns: true });
    const complete = parseThreadSnapshot(raw, id);
    if (sequence !== generation.current) return;
    await replaceMessages(host.id, id, complete);
    if (active.current === id && sequence === generation.current) {
      setMessages(complete);
      setLastSynced(Date.now());
    }
  }, [host]);

  const chooseThread = useCallback(async (id: string) => {
    if (!host) return;
    active.current = id;
    setActiveThreadId(id);
    generation.current++;
    setRunning(false);
    const cached = await loadMessages(host.id, id);
    if (active.current === id) setMessages(cached);
    if (client.current?.connected) {
      try {
        await client.current.request('thread/resume', { threadId: id });
        await readThread(id);
      } catch (e) { setError(errorString(e)); }
    }
  }, [host, readThread]);

  const refresh = useCallback(async () => {
    if (!host || !client.current?.connected) return;
    const result = await client.current.request('thread/list', {
      limit: 100, sortKey: 'recency_at',
    });
    const list = parseThreadList(result);
    await storeThreads(host.id, list);
    setThreads(list);
    if (active.current) await readThread(active.current);
  }, [host, readThread]);

  useEffect(() => {
    disposed.current = false;
    const currentHost = host;
    setStatus('offline');
    setThreads([]);
    setMessages([]);
    setError(null);
    active.current = null;
    setActiveThreadId(null);
    generation.current++;
    if (!currentHost) return;

    let retry = 0;
    let alive = true;
    const handleNotice = (notice: CodexNotice) => {
      const threadId = active.current;
      if (threadId) {
        const p = notice.params;
        const eventThread = p.threadId ?? recordOf(p.thread).id;
        if (eventThread === threadId) {
          if (notice.method === 'turn/started') setRunning(true);
          if (notice.method === 'turn/completed') {
            setRunning(false);
            void readThread(threadId).catch((e) => setError(errorString(e)));
          }
          if (notice.method === 'item/completed' ||
              notice.method === 'item/agentMessage/delta') {
            setMessages((old) => applyNotification(old, notice, threadId));
          }
        }
      }
      if (notice.method === 'thread/started' || notice.method === 'thread/name/updated') {
        // A thread may have been created by Desktop or AOI.
        void client.current?.request('thread/list', { limit: 100, sortKey: 'recency_at' })
          .then((result) => {
            if (!alive) return;
            const list = parseThreadList(result);
            setThreads(list);
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
      reconnect.current = setTimeout(() => {
        reconnect.current = null;
        void establish();
      },
        Math.min(20_000, 1000 * 2 ** Math.min(retry, 4)));
    };
    const establish = async () => {
      if (!alive) return;
      setStatus('connecting');
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
        setError(null);
        const result = await connection.request('thread/list', { limit: 100, sortKey: 'recency_at' });
        const list = parseThreadList(result);
        if (!alive) return;
        setThreads(list);
        void storeThreads(currentHost.id, list);
        const selected = active.current ?? list[0]?.id ?? null;
        if (selected) {
          active.current = selected;
          setActiveThreadId(selected);
          await connection.request('thread/resume', { threadId: selected });
          await readThread(selected, connection);
        }
      } catch (e) {
        if (!alive) return;
        setError(errorString(e));
        if (client.current) client.current.close();
        scheduleReconnect();
      }
    };

    void (async () => {
      try {
        const cached = await loadThreads(currentHost.id);
        if (!alive) return;
        setThreads(cached);
        if (cached[0]) {
          active.current = cached[0].id;
          setActiveThreadId(cached[0].id);
          setMessages(await loadMessages(currentHost.id, cached[0].id));
        }
      } catch (e) { if (alive) setError(errorString(e)); }
      if (alive) await establish();
    })();

    return () => {
      alive = false;
      disposed.current = true;
      if (reconnect.current) clearTimeout(reconnect.current);
      client.current?.close();
      client.current = null;
    };
  }, [host?.id, readThread]);

  const createThread = useCallback(async (cwd: string | null) => {
    if (!client.current?.connected) throw new Error('当前无法新建会话：电脑离线');
    const response = await client.current.request('thread/start', cwd ? { cwd } : {});
    const id = recordOf(recordOf(response).thread).id;
    if (typeof id !== 'string') throw new Error('Codex 未返回新会话 ID');
    await refresh();
    await chooseThread(id);
  }, [refresh, chooseThread]);

  const send = useCallback(async (text: string) => {
    const id = active.current;
    if (!id || !client.current?.connected) throw new Error('离线时只能保存草稿，不会自动发送');
    if (!text.trim()) return;
    setError(null);
    try {
      await client.current.request('turn/start', {
        threadId: id, input: [{ type: 'text', text }],
      });
      // Real server messages, not optimistic locally invented turns.
      await readThread(id);
    } catch (e) {
      setError('发送状态未确认。请先核对电脑端会话，再决定是否重发。' + errorString(e));
      void readThread(id).catch(() => undefined);
      throw e;
    }
  }, [readThread]);

  return { status, threads, activeThreadId, messages, running, lastSynced,
    error, chooseThread, createThread, send, refresh };
}
