import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ThreadCompletionStore } from './threadCompletions.js';

function reply(res: ServerResponse, status: number, result: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(result));
}

/** Same-origin Coordinator route used by the shared Web UI. */
export async function handleThreadCompletionsHttp(
  req: IncomingMessage,
  res: ServerResponse,
  store: ThreadCompletionStore,
  origin: string,
): Promise<boolean> {
  const name = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (name !== '/api/thread-completions' || !['GET', 'POST'].includes(req.method ?? '')) {
    return false;
  }
  try {
    if (req.method === 'GET') {
      reply(res, 200, await store.list());
      return true;
    }
    if (req.headers.origin !== origin ||
        !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      throw Error('INVALID_REQUEST');
    }
    let raw = '';
    for await (const chunk of req) {
      raw += chunk.toString('utf8');
      if (raw.length > 1024) throw Error('INVALID_REQUEST');
    }
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 2 || !('thread' in body) || !('completed' in body)) {
      throw Error('INVALID_REQUEST');
    }
    reply(res, 200, await store.set(body.thread, body.completed));
  } catch {
    reply(res, 400, { error: 'COMPLETIONS_REQUEST_FAILED' });
  }
  return true;
}
