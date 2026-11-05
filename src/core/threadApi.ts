import type { CodexThread, JsonObject } from './protocol';
import { normalizeThread, parseThreadList, recordOf } from './protocol';

/** The native Codex RPC surface, independent of React, Android and the gateway. */
export interface ThreadRpcClient {
  request(method: string, params: JsonObject): Promise<unknown>;
}

export interface ThreadPage {
  threads: CodexThread[];
  nextCursor: string | null;
}

export function parseThreadPage(result: unknown): ThreadPage {
  const page = recordOf(result);
  const cursor = page.nextCursor;
  if (cursor !== null && cursor !== undefined && typeof cursor !== 'string') {
    throw new Error('Codex thread/list returned an invalid cursor');
  }
  return {
    threads: parseThreadList(result),
    nextCursor: typeof cursor === 'string' && cursor.length ? cursor : null,
  };
}

/**
 * Load paginated native Desktop history, not merely the first 100 threads.
 * A broken/looping cursor causes a failure rather than silently presenting an
 * incomplete list as authoritative. Cache is only updated after all pages.
 */
export async function listAllThreads(client: ThreadRpcClient): Promise<CodexThread[]> {
  const byId = new Map<string, CodexThread>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  const MAX_PAGES = 100;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const result = await client.request('thread/list', {
      // When omitted, the server filters by its configured model provider.
      // Desktop history may use multiple provider IDs, even for the same host.
      limit: 100, sortKey: 'recency_at', modelProviders: [], ...(cursor ? { cursor } : {}),
    });
    const page = parseThreadPage(result);
    for (const thread of page.threads) {
      if (!byId.has(thread.id)) byId.set(thread.id, thread);
    }
    if (page.nextCursor === null) return [...byId.values()];
    if (cursors.has(page.nextCursor)) {
      throw new Error('Codex thread/list repeated its pagination cursor; keeping cached history');
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error('Codex thread/list returned more than 100 pages; keeping cached history');
}

/** thread/start creates a live thread, which may not be persisted yet. */
export async function startLiveThread(
  client: ThreadRpcClient, cwd: string, projectId: string | null = null,
): Promise<CodexThread> {
  const raw = await client.request('thread/start', {
    cwd, ...(projectId ? { projectId } : {}),
    ...(!projectId ? { sandbox: 'workspace-write', approvalPolicy: 'on-request' } : {}),
  });
  const thread = normalizeThread(recordOf(raw).thread);
  if (!thread) throw new Error('Codex did not confirm the new thread ID; check Desktop before retrying');
  return {
    ...thread, cwd: thread.cwd ?? cwd,
    projectId: thread.projectId ?? projectId, updatedAt: thread.updatedAt || Date.now() / 1000,
  };
}

/** Show temporary live threads without persisting fake entries in SQLite. */
export function includeLiveThreads(
  listed: readonly CodexThread[], live: ReadonlyMap<string, CodexThread>,
): CodexThread[] {
  const persistedIds = new Set(listed.map((thread) => thread.id));
  return [
    ...[...live.values()].filter((thread) => !persistedIds.has(thread.id)).reverse(),
    ...listed,
  ];
}
