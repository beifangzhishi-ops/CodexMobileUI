/** Connection-scoped proof that a child thread is attached to its native parent. */
export class SubAgentProofCache {
  #proofs = new Map();
  constructor({ maxEntries = 64, ttlMs = 60_000, now = Date.now } = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }
  #key(parentId, childId) { return JSON.stringify([parentId, childId]); }
  has(parentId, childId) {
    const key = this.#key(parentId, childId), createdAt = this.#proofs.get(key);
    if (createdAt === undefined) return false;
    if (this.now() - createdAt > this.ttlMs) { this.#proofs.delete(key); return false; }
    return true;
  }
  remember(parentId, childId) {
    const key = this.#key(parentId, childId);
    this.#proofs.delete(key);
    this.#proofs.set(key, this.now());
    while (this.#proofs.size > this.maxEntries) this.#proofs.delete(this.#proofs.keys().next().value);
  }
  invalidateParent(parentId) {
    for (const key of this.#proofs.keys()) {
      if (JSON.parse(key)[0] === parentId) this.#proofs.delete(key);
    }
  }
}

/** Return a bounded, output-free projection for automatic activity refreshes. */
export function projectSubAgentActivitySnapshot(raw, expectedThreadId) {
  const thread = raw?.thread;
  if (thread?.id !== expectedThreadId || !Array.isArray(thread.turns)) throw Error('AGENT_NOT_FOUND');
  const turns = thread.turns.slice(-8);
  const itemsByTurn = new Map(turns.map((turn) => [turn.id, []]));
  let remaining = 24;
  const bounded = (value, limit = 320) => typeof value === 'string'
    ? value.replace(/[\0\r]/g, '').slice(0, limit) : undefined;
  for (const turn of [...turns].reverse()) {
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const item of [...items].slice(-24).reverse()) {
      if (remaining <= 0) break;
      let value;
      switch (item?.type) {
        case 'commandExecution':
          value = { command: bounded(item.command), exitCode: item.exitCode };
          break;
        case 'fileChange':
          value = { changes: Array.isArray(item.changes) ? item.changes.slice(0, 8).map((change) => ({
            kind: bounded(change?.kind, 40), path: bounded(change?.path, 500),
          })) : [] };
          break;
        case 'mcpToolCall': case 'dynamicToolCall':
          value = { server: bounded(item.server, 120), tool: bounded(item.tool, 160) };
          break;
        case 'webSearch': value = { query: bounded(item.query, 240) }; break;
        case 'imageView': value = { path: bounded(String(item.path ?? '').split(/[\\/]/).at(-1), 160) }; break;
        case 'collabToolCall': case 'collabAgentToolCall':
          value = { tool: bounded(item.tool, 160) };
          break;
        case 'subAgentActivity':
          value = { kind: bounded(item.kind, 40), agentThreadId: bounded(item.agentThreadId, 128),
            agentPath: bounded(item.agentPath, 240) };
          break;
        default: continue;
      }
      itemsByTurn.get(turn.id).push({ id: bounded(item.id, 128), type: item.type, status: bounded(item.status, 40), ...value });
      remaining--;
    }
    if (remaining <= 0) break;
  }
  return { thread: { id: thread.id, name: bounded(thread.name, 160) ?? '',
    turns: turns.map((turn) => ({ id: turn.id, status: turn.status, startedAt: turn.startedAt,
      completedAt: turn.completedAt, items: (itemsByTurn.get(turn.id) ?? []).reverse() })) } };
}
