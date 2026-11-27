import { useEffect, useRef, useState } from 'react';
import { validHostId, type HostId } from './types.ts';

const preference = 'codex-web-system-notifications';
const cursorKey = preference + '-cursor';

type Target = { hostId: HostId; threadId: string };
type Completion = Target & {
  seq: number;
  status: 'completed' | 'failed' | 'interrupted';
  title: string;
  preview: string;
};

function completion(value: unknown): Completion | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<Completion>;
  return Number.isSafeInteger(event.seq) && event.seq! > 0 &&
    validHostId(event.hostId) &&
    typeof event.threadId === 'string' && /^[a-zA-Z0-9_-]{8,256}$/.test(event.threadId) &&
    typeof event.title === 'string' && typeof event.preview === 'string' &&
    (event.status === 'completed' || event.status === 'failed' || event.status === 'interrupted')
    ? event as Completion : null;
}

function readCursor(): number | null {
  const raw = localStorage.getItem(cursorKey);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function show(event: Completion) {
  const result = { completed: '本轮已完成', failed: '执行失败', interrupted: '已中断' }[event.status];
  const notice = new Notification(event.title.slice(0, 160) || '新对话', {
    body: event.hostId + ' · ' + result + (event.preview ? '\n' + event.preview.slice(0, 720) : ''),
    tag: 'codex-turn-' + event.seq,
  });
  notice.onclick = () => {
    window.focus();
    window.dispatchEvent(new CustomEvent('codexmobileui:open-thread', {
      detail: { hostId: event.hostId, threadId: event.threadId },
    }));
    notice.close();
  };
}

export function useBrowserNotifications(active: Target | null) {
  const visibleTarget = useRef(active);
  useEffect(() => { visibleTarget.current = active; }, [active]);
  const platform = window as Window & { ReactNativeWebView?: unknown; codexDesktop?: unknown };
  const available = window.isSecureContext && typeof Notification !== 'undefined' &&
    !platform.ReactNativeWebView && !platform.codexDesktop;
  const [enabled, setEnabled] = useState(() => available &&
    Notification.permission === 'granted' && localStorage.getItem(preference) === 'on');
  const [error, setError] = useState('');

  async function toggle(next: boolean) {
    if (!available) return;
    setError('');
    try {
      if (next && await Notification.requestPermission() !== 'granted') {
        setError('请在浏览器的站点设置中允许通知。');
        return;
      }
      if (!next) localStorage.removeItem(cursorKey);
      localStorage.setItem(preference, next ? 'on' : 'off');
      setEnabled(next);
    } catch {
      setError('无法保存浏览器通知设置。');
    }
  }

  useEffect(() => {
    if (!available) return;
    const sync = () => setEnabled(Notification.permission === 'granted' &&
      localStorage.getItem(preference) === 'on');
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
    };
  }, [available]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let socket: WebSocket;
    let timer: number | undefined;
    let attempts = 0;
    let cursor = readCursor();
    const url = new URL('/api/notifications', location.origin);
    url.protocol = 'wss:';
    function connect() {
      const after = readCursor() ?? cursor;
      const connection = new WebSocket(url);
      socket = connection;
      connection.onopen = () => connection.send(JSON.stringify({ type: 'subscribe', after }));
      connection.onmessage = ({ data }) => {
        if (disposed || typeof data !== 'string' || data.length > 512_000) return;
        try {
          const message = JSON.parse(data);
          const replay = message?.type === 'replay' && Array.isArray(message.events) &&
            Number.isSafeInteger(message.latest) && message.latest >= 0;
          const events: unknown[] = replay ? message.events.slice(0, 300)
            : message?.type === 'event' ? [message.event] : [];
          const deliver = () => {
            if (disposed || localStorage.getItem(preference) !== 'on') return;
            const stored = readCursor();
            cursor = replay && after !== null && message.latest < after && stored === after
              ? null : stored ?? cursor;
            const pending: Completion[] = [];
            for (const raw of events) {
              const event = completion(raw);
              if (!event || event.seq <= (cursor ?? 0)) continue;
              cursor = event.seq;
              const target = visibleTarget.current;
              if (document.visibilityState !== 'visible' || !document.hasFocus() ||
                  target?.hostId !== event.hostId || target.threadId !== event.threadId) {
                pending.push(event);
              }
            }
            if (replay) cursor = Math.max(cursor ?? 0, message.latest);
            if (cursor !== null) localStorage.setItem(cursorKey, String(cursor));
            if (Notification.permission !== 'granted') return;
            if (pending.length > 3) {
              const notice = new Notification('CodexMobileUI', {
                body: '离线期间有 ' + pending.length + ' 个任务结束。',
                tag: 'codex-turn-summary',
              });
              notice.onclick = () => { window.focus(); notice.close(); };
            } else pending.forEach(show);
          };
          if (replay) attempts = 0;
          if (navigator.locks) void navigator.locks.request(cursorKey, deliver).catch(() => undefined);
          else deliver();
        } catch { /* Ignore malformed frames or unavailable notifications. */ }
      };
      connection.onclose = () => {
        if (!disposed) timer = window.setTimeout(connect, Math.min(30_000, 1500 * 2 ** Math.min(attempts++, 5)));
      };
    }
    connect();
    return () => { disposed = true; window.clearTimeout(timer); socket?.close(); };
  }, [enabled]);

  return { available, enabled, error, toggle };
}
