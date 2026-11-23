import { useEffect, useRef, useState } from 'react';
import { obj, parseThreads, text } from './nativeProtocol';
import { hosts, type Conversation, type HostId } from './types';

type Request = (hostId: HostId, method: string, params: Record<string, unknown>, timeout: number) => Promise<unknown>;
type Hit = { conversation: Conversation; snippet?: string };
type Source = { hostId: HostId; titlesOnly: boolean; cursor?: string };
type Page = { hits: Hit[]; next?: Source; failed?: boolean };

async function searchPage(request: Request, query: string, source: Source): Promise<Page> {
  const { hostId, titlesOnly, cursor } = source;
  const result = obj(await request(hostId, titlesOnly ? 'thread/list' : 'thread/search', {
    searchTerm: query, limit: 25, archived: false, sortKey: 'recency_at', sourceKinds: [],
    ...(cursor ? { cursor } : {}),
    ...(titlesOnly ? { modelProviders: [], useStateDbOnly: true } : {}),
  }, 12_000));
  if (!Array.isArray(result.data)) throw Error('INVALID_SEARCH_RESULT');
  const hits = result.data.flatMap((raw): Hit[] => {
    const row = obj(raw);
    const thread = titlesOnly ? row : obj(row.thread);
    if (thread.ephemeral === true || thread.threadSource === 'ambient_suggestions') return [];
    const [conversation] = parseThreads({ data: [thread] }, hostId);
    return conversation ? [{ conversation, snippet: text(row.snippet).slice(0, 400) }] : [];
  });
  const after = text(result.nextCursor);
  return { hits, next: after && after !== cursor ? { ...source, cursor: after } : undefined };
}

export function useThreadSearch(open: boolean, query: string, online: Record<HostId, string>, request: Request) {
  const sixOnline = online['6v'] === 'online';
  const nohaOnline = online.noha === 'online';
  const key = open && query ? JSON.stringify([query, sixOnline, nohaOnline]) : '';
  const session = useRef<{ key: string; busy: boolean } | null>(null);
  const [state, setState] = useState<{ key: string; pages: Page[]; pending: boolean }>({ key: '', pages: [], pending: false });

  async function fetchPages(current: NonNullable<typeof session.current>, sources: Source[], previous: Page[], term: string) {
    current.busy = true;
    setState({ key: current.key, pages: previous, pending: true });
    await Promise.all(sources.map(async (source) => {
      const page = await searchPage(request, term, source).catch((): Page => ({ hits: [], failed: true }));
      if (session.current === current) {
        setState((state) => ({ ...state, pages: [...state.pages, page] }));
      }
    }));
    current.busy = false;
    if (session.current === current) setState((state) => ({ ...state, pending: false }));
  }

  useEffect(() => {
    if (!key || (!sixOnline && !nohaOnline)) {
      setState({ key: '', pages: [], pending: false });
      return;
    }
    const current = { key, busy: false };
    session.current = current;
    const sources = hosts.filter(({ id }) => id === '6v' ? sixOnline : nohaOnline)
      .flatMap(({ id }) => [false, true].map((titlesOnly) => ({ hostId: id, titlesOnly })));
    const timer = window.setTimeout(() => void fetchPages(current, sources, [], query), 200);
    return () => { clearTimeout(timer); session.current = null; };
  }, [key, sixOnline, nohaOnline, query, request]);

  const pages = state.key === key ? state.pages : [];
  const hits = new Map<string, Hit>();
  for (const page of pages) for (const hit of page.hits) {
    const id = hit.conversation.hostId + ':' + hit.conversation.id;
    if (!hits.has(id) || (hit.snippet && !hits.get(id)?.snippet)) hits.set(id, hit);
  }
  const next = pages.flatMap((page) => page.next ? [page.next] : []);
  return {
    hits: [...hits.values()].sort((a, b) => b.conversation.updatedAt - a.conversation.updatedAt),
    pending: !!key && (sixOnline || nohaOnline) && (state.key !== key || state.pending),
    error: pages.every((page) => page.failed) && pages.length > 0 ? '搜索失败'
      : pages.some((page) => page.failed) ? '部分搜索请求失败' : null,
    hasMore: next.length > 0,
    loadMore() {
      const current = session.current;
      if (!current || current.key !== key || current.busy || !next.length) return;
      void fetchPages(current, next, pages.map((page) => ({ ...page, next: undefined })), query);
    },
  };
}
