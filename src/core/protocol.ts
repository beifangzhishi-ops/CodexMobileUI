/**
 * Minimal view of the shared Codex App Server wire protocol.
 * We do not persist a second canonical conversation model on the phone.
 */
export type JsonObject = Record<string, unknown>;

export interface CodexThread {
  id: string;
  name: string | null;
  cwd: string | null;
  updatedAt: number;
  turns?: unknown[];
}

export interface ChatMessage {
  id: string;
  threadId: string;
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  ordinal: number;
  /** Committed server items are final; late/replayed deltas must not append to them. */
  complete?: boolean;
}

export interface CodexNotice {
  method: string;
  params: JsonObject;
  /** JSON-RPC server requests use an id and require a response; notifications do not. */
  requestId?: number;
}

export function recordOf(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function normalizeThread(input: unknown): CodexThread | null {
  const value = recordOf(input);
  if (!optionalString(value.id)) return null;
  const date = value.recencyAt ?? value.updatedAt ?? value.createdAt;
  const timestamp = typeof date === 'number' ? date : 0;
  return {
    id: value.id as string,
    name: optionalString(value.name) ?? optionalString(value.title),
    cwd: optionalString(value.cwd),
    updatedAt: timestamp,
    ...(Array.isArray(value.turns) ? { turns: value.turns } : {}),
  };
}

function itemText(item: JsonObject): string {
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return '';
  return item.content.map((part) => {
    const node = recordOf(part);
    return node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  }).join('\n');
}

function messageFromItem(
  threadId: string,
  turnId: string,
  input: unknown,
  index: number,
  fallbackId?: string,
): ChatMessage | null {
  const item = recordOf(input);
  if (item.type !== 'userMessage' && item.type !== 'agentMessage') return null;
  const text = itemText(item);
  if (!text) return null;
  const itemId = optionalString(item.id) ?? fallbackId ?? `item-${index}`;
  return {
    id: `${turnId}:${itemId}`,
    threadId,
    turnId,
    role: item.type === 'userMessage' ? 'user' : 'assistant',
    text,
    ordinal: index,
    complete: true,
  };
}

/** Convert only committed server history, never assistant-stream placeholders. */
export function extractMessages(threadId: string, turns: readonly unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const [turnIndex, raw] of turns.entries()) {
    const turn = recordOf(raw);
    const turnId = optionalString(turn.id);
    if (!turnId || !Array.isArray(turn.items)) continue;
    for (const [itemIndex, item] of turn.items.entries()) {
      const message = messageFromItem(threadId, turnId, item, itemIndex);
      if (message) messages.push({ ...message, ordinal: turnIndex * 100_000 + itemIndex });
    }
  }
  return messages;
}

/** Apply a Codex event to cached text without creating duplicate historical items. */
export function applyNotification(
  previous: readonly ChatMessage[],
  notice: CodexNotice,
  threadId: string,
): ChatMessage[] {
  const p = notice.params;
  const targetThread = p.threadId ?? recordOf(p.thread).id;
  if (targetThread !== threadId) return [...previous];
  const turnId = optionalString(p.turnId) ?? optionalString(recordOf(p.turn).id);
  if (!turnId) return [...previous];
  const itemId = optionalString(p.itemId) ?? optionalString(recordOf(p.item).id);
  if (notice.method === 'item/completed' && itemId) {
    const converted = messageFromItem(threadId, turnId, p.item, 0, itemId);
    return converted ? upsertMessage(previous, converted) : [...previous];
  }
  if (notice.method === 'item/agentMessage/delta' && itemId && typeof p.delta === 'string') {
    const id = `${turnId}:${itemId}`;
    const current = previous.find((m) => m.id === id);
    if (current) {
      if (current.complete) return [...previous];
      return previous.map((m) => m.id === id ? { ...m, text: m.text + p.delta } : m);
    }
    return [...previous, {
      id, threadId, turnId, role: 'assistant', text: p.delta, complete: false,
      ordinal: previous.length ? Math.max(...previous.map((m) => m.ordinal)) + 1 : 0,
    }];
  }
  return [...previous];
}

export function upsertMessage(messages: readonly ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const found = messages.findIndex((m) => m.id === incoming.id);
  if (found < 0) return [...messages, incoming];
  return messages.map((m, index) => index === found
    ? { ...incoming, ordinal: m.ordinal }
    : m);
}

export function parseThreadList(result: unknown): CodexThread[] {
  const data = recordOf(result).data;
  if (!Array.isArray(data)) {
    throw new Error('Codex thread/list returned an unrecognized result; keeping local history');
  }
  return data
    .map(normalizeThread)
    .filter((thread): thread is CodexThread => thread !== null);
}

export function parseThreadSnapshot(result: unknown, fallbackThreadId: string): ChatMessage[] {
  return parseThreadSnapshotState(result, fallbackThreadId).messages;
}

export interface ThreadSnapshotState {
  messages: ChatMessage[];
  running: boolean;
}

export function parseThreadSnapshotState(
  result: unknown,
  fallbackThreadId: string,
): ThreadSnapshotState {
  const thread = recordOf(recordOf(result).thread);
  if (!Array.isArray(thread.turns)) {
    throw new Error('Codex thread/read did not include turns; keeping cached messages');
  }
  const actualId = optionalString(thread.id) ?? fallbackThreadId;
  if (actualId !== fallbackThreadId) {
    throw new Error('Codex thread/read returned a different thread; keeping cached messages');
  }
  const lastTurn = recordOf(thread.turns[thread.turns.length - 1]);
  const running = lastTurn.status === 'inProgress' ||
    lastTurn.status === 'in_progress' ||
    lastTurn.status === 'running';
  const incompleteTurnId = running ? optionalString(lastTurn.id) : null;
  const messages = extractMessages(actualId, thread.turns).map((message) =>
    incompleteTurnId === message.turnId && message.role === 'assistant'
      ? { ...message, complete: false }
      : message);
  return { messages, running };
}
