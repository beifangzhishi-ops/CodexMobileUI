import type { CodexThread, JsonObject } from './protocol';
import { parseThreadList, recordOf } from './protocol';

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
      limit: 100, sortKey: 'recency_at', ...(cursor ? { cursor } : {}),
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
