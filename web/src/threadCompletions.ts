import { validHostId, type HostId } from './types.ts';

export type CompletedThread = { hostId: HostId; threadId: string };
export type ThreadCompletionsSnapshot = { revision: number; items: CompletedThread[] };

export function parseThreadCompletions(value: unknown): ThreadCompletionsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('INVALID_THREAD_COMPLETIONS');
  }
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 2 ||
      typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision) || data.revision < 0 ||
      !Array.isArray(data.items) || data.items.length > 2000 ||
      !data.items.every((item: unknown) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const thread = item as Record<string, unknown>;
        return Object.keys(thread).length === 2 &&
          validHostId(thread.hostId) &&
          typeof thread.threadId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(thread.threadId);
      })) {
    throw Error('INVALID_THREAD_COMPLETIONS');
  }
  const items = data.items as CompletedThread[];
  if (new Set(items.map((item) => item.hostId + ':' + item.threadId)).size !== items.length) {
    throw Error('INVALID_THREAD_COMPLETIONS');
  }
  return data as ThreadCompletionsSnapshot;
}

export async function fetchThreadCompletions(): Promise<ThreadCompletionsSnapshot> {
  const response = await fetch('/api/thread-completions', { cache: 'no-store' });
  if (!response.ok) throw Error('THREAD_COMPLETIONS_UNAVAILABLE');
  return parseThreadCompletions(await response.json());
}

export async function setThreadCompletion(
  thread: CompletedThread,
  completed: boolean,
): Promise<ThreadCompletionsSnapshot> {
  const response = await fetch('/api/thread-completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thread, completed }),
    cache: 'no-store',
  });
  if (!response.ok) throw Error('THREAD_COMPLETIONS_UNAVAILABLE');
  return parseThreadCompletions(await response.json());
}

/** Completion persistence is server-owned; browser caching is optional. */
export function writeCachedThreadCompletions(
  storage: ({ setItem: (key: string, value: string) => void } |
    (() => { setItem: (key: string, value: string) => void }) | null),
  snapshot: ThreadCompletionsSnapshot,
): void {
  try {
    const writable = typeof storage === 'function' ? storage() : storage;
    writable?.setItem('codex-web-thread-completions', JSON.stringify(snapshot));
  } catch { /* Private or full storage must not turn an acknowledged save into an error. */ }
}
