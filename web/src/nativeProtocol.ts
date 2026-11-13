import type { Conversation, HostId, Message } from './types';

type Obj = Record<string, unknown>;
export const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
export const text = (value: unknown): string => typeof value === 'string' ? value : '';
const clip = (value: string, limit = 20_000) => value.length > limit ? value.slice(0, limit) + '\n…' : value;
const jsonText = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
const unixMs = (timestamp: unknown) => typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 ? timestamp * (timestamp < 1e12 ? 1000 : 1) : undefined;
const toolTypes = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabToolCall', 'webSearch', 'imageView', 'functionCallOutput', 'contextCompaction', 'enteredReviewMode', 'exitedReviewMode']);

export type NativeProject = { id: string; hostId: HostId; name: string; roots: string[]; position: number | null };
export type NativeModel = { id: string; name: string; isDefault: boolean; efforts: string[]; defaultEffort: string | null };
export type NativePermission = { id: string; allowed: boolean; description: string };
export type NativeGoal = { objective: string; status: string; tokenBudget: number | null; tokensUsed: number; timeUsedSeconds: number };
export type NativeQueueEntry = { id: string; text: string };
export type Snapshot = { messages: Message[]; running: boolean; activeTurnId: string | null; runningSinceMs: number | null };
export type NativeNotice = { method: string; params: Obj };

export function parseProjects(data: unknown, hostId: HostId): NativeProject[] {
  const rows = obj(data).data;
  if (!Array.isArray(rows)) throw Error('INVALID_PROJECT_LIST');
  return rows.flatMap((raw): NativeProject[] => {
    const item = obj(raw);
    if (!text(item.id) || !text(item.name)) return [];
    return [{ id: text(item.id), hostId, name: text(item.name),
      roots: Array.isArray(item.roots) ? item.roots.flatMap((root) => {
        const path = typeof root === 'string' ? root : obj(root).path;
        return typeof path === 'string' ? [path] : [];
      }) : [],
      position: typeof item.position === 'number' ? item.position : null }];
  }).sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
}

export function parseThreads(data: unknown, hostId: HostId, archived = false): Conversation[] {
  const rows = obj(data).data;
  if (!Array.isArray(rows)) throw Error('INVALID_THREAD_LIST');
  return rows.flatMap((raw): Conversation[] => {
    const thread = obj(raw);
    if (!text(thread.id)) return [];
    const state = obj(thread.status);
    const running = [thread.status, state.type, state.status].some((s) => ['active', 'inProgress', 'running'].includes(text(s)));
    return [{ id: text(thread.id), hostId, project: text(thread.projectId) || null,
      title: text(thread.name) || text(thread.title) || text(thread.preview) || '未命名对话',
      status: running ? 'running' : 'idle', archived,
      updatedAt: unixMs(thread.recencyAt ?? thread.updatedAt ?? thread.createdAt) ?? 0,
      running, syncPending: false, activeTurnId: null, runningSinceMs: null, messages: [] }];
  });
}

export function parseModels(value: unknown): NativeModel[] {
  const rows = obj(value).data;
  if (!Array.isArray(rows)) throw Error('INVALID_MODEL_LIST');
  return rows.flatMap((raw): NativeModel[] => {
    const model = obj(raw);
    const id = text(model.id) || text(model.model);
    if (!id || model.hidden === true) return [];
    const efforts = Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts.map((entry) => text(obj(entry).reasoningEffort)).filter(Boolean) : [];
    return [{ id, name: text(model.displayName) || id, isDefault: model.isDefault === true,
      efforts, defaultEffort: text(model.defaultReasoningEffort) || null }];
  });
}

export function parsePermissions(value: unknown): NativePermission[] {
  const rows = obj(value).data;
  if (!Array.isArray(rows)) throw Error('INVALID_PERMISSION_LIST');
  return rows.flatMap((raw): NativePermission[] => {
    const row = obj(raw);
    return text(row.id) ? [{ id: text(row.id), allowed: row.allowed === true, description: text(row.description) }] : [];
  });
}

export function parseGoal(value: unknown, threadId: string): NativeGoal | null {
  if (value == null) return null;
  const item = obj(value);
  if (item.threadId !== threadId || !text(item.objective) ||
      !['active','paused','blocked','usageLimited','budgetLimited','complete'].includes(text(item.status)))
    throw Error('INVALID_GOAL');
  return { objective: text(item.objective), status: text(item.status),
    tokenBudget: typeof item.tokenBudget === 'number' ? item.tokenBudget : null,
    tokensUsed: typeof item.tokensUsed === 'number' ? item.tokensUsed : 0,
    timeUsedSeconds: typeof item.timeUsedSeconds === 'number' ? item.timeUsedSeconds : 0 };
}

export function parseQueue(value: unknown): NativeQueueEntry[] {
  const rows = obj(value).data;
  if (!Array.isArray(rows)) throw Error('INVALID_QUEUE');
  return rows.flatMap((raw): NativeQueueEntry[] => {
    const item = obj(raw);
    if (!text(item.id) || !Array.isArray(item.input)) return [];
    const content = item.input.map((entry) => obj(entry)).filter((entry) => entry.type === 'text').map((entry) => text(entry.text)).filter(Boolean).join('\n');
    return content ? [{ id: text(item.id), text: content }] : [];
  });
}

function contentText(item: Obj): string {
  if (typeof item.text === 'string') return item.text;
  return Array.isArray(item.content) ? item.content.map((part) => {
    const p = obj(part);
    return p.type === 'text' ? text(p.text) : '';
  }).filter(Boolean).join('\n') : '';
}

function messageFromItem(item: Obj, turnId: string, ordinal: number, startedAtMs?: number, completedAtMs?: number): Message | null {
  if (item.type !== 'userMessage' && item.type !== 'agentMessage') return null;
  const content = contentText(item);
  if (!content) return null;
  return { id: turnId + ':' + (text(item.id) || 'item-' + ordinal), turnId, ordinal,
    role: item.type === 'userMessage' ? 'user' : 'assistant', content,
    timestampMs: unixMs(item.type === 'userMessage' ? item.startedAtMs ?? startedAtMs : item.completedAtMs ?? completedAtMs ?? startedAtMs),
    complete: true };
}

function summaryParts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.map((part) => typeof part === 'string' ? part : text(obj(part).text)).filter(Boolean) : [];
}

function activityFromItem(item: Obj, turnId: string, ordinal: number, complete: boolean): Message | null {
  const kind = text(item.type), itemId = text(item.id);
  if (!itemId || kind !== 'reasoning' && kind !== 'plan' && !toolTypes.has(kind)) return null;
  const base = { id: turnId + ':' + itemId, turnId, ordinal, complete, role: 'assistant' as const };
  const status = text(item.status) || (complete ? 'completed' : 'inProgress');
  const failed = ['failed','declined','error'].includes(status) ||
    kind === 'commandExecution' && typeof item.exitCode === 'number' && item.exitCode !== 0;
  if (kind === 'reasoning') {
    const parts = summaryParts(item.summary);
    if (!parts.length) return null;
    return { ...base, kind: 'reasoning', title: '思考摘要', content: clip(parts.join('\n\n')), summaryParts: parts, status };
  }
  if (kind === 'plan') return { ...base, kind: 'plan', title: '计划', content: clip(text(item.text)), status };
  let title = '工具调用', content = '', detail = '';
  if (kind === 'commandExecution') {
    title = '执行命令'; content = clip(text(item.command), 300);
    detail = [text(item.cwd) ? '工作目录：' + text(item.cwd) : '', content ? '命令：' + content : '',
      item.aggregatedOutput != null ? '输出：\n' + jsonText(item.aggregatedOutput) : '',
      typeof item.exitCode === 'number' ? '退出码：' + item.exitCode : ''].filter(Boolean).join('\n\n');
  } else if (kind === 'fileChange') {
    title = '修改文件';
    const changes = Array.isArray(item.changes) ? item.changes.map(obj) : [];
    content = changes.map((c) => text(c.path)).filter(Boolean).join('、') || '文件变更';
    detail = changes.map((c) => [text(c.kind) + ' ' + text(c.path), text(c.diff)].filter(Boolean).join('\n')).join('\n\n');
  } else if (kind === 'mcpToolCall' || kind === 'dynamicToolCall') {
    title = kind === 'mcpToolCall' ? 'MCP 工具调用' : '工具调用';
    content = [text(item.server), text(item.tool)].filter(Boolean).join(' / ');
    detail = [item.arguments != null ? '参数：\n' + jsonText(item.arguments) : '',
      item.result != null ? '结果：\n' + jsonText(item.result) : '',
      item.error != null ? '错误：\n' + jsonText(item.error) : ''].filter(Boolean).join('\n\n');
  } else if (kind === 'webSearch') { title = '网页搜索'; content = text(item.query); detail = jsonText(item.action); }
  else if (kind === 'imageView') { title = '查看图片'; content = text(item.path); }
  else if (kind === 'collabToolCall') { title = '协作代理'; content = text(item.tool); detail = text(item.prompt); }
  else if (kind === 'contextCompaction') { title = '上下文压缩'; }
  else if (kind === 'enteredReviewMode' || kind === 'exitedReviewMode') { title = kind === 'enteredReviewMode' ? '开始代码审查' : '完成代码审查'; }
  else { content = text(item.name) || kind; detail = jsonText(item.output); }
  return { ...base, kind: 'tool', activityType: kind, title, content: clip(content, 1500),
    detail: clip(detail), status, failed };
}

function merge(list: readonly Message[], message: Message): Message[] {
  const current = list.find((m) => m.id === message.id);
  if (!current) return [...list, message];
  return list.map((m) => m.id === message.id ? { ...message, ordinal: m.ordinal } : m);
}
const nextOrdinal = (items: readonly Message[]) => items.reduce((value, item) => Math.max(value, item.ordinal ?? -1), -1) + 1;

export function parseSnapshot(raw: unknown, expectedThreadId: string): Snapshot {
  const thread = obj(obj(raw).thread);
  if (text(thread.id) && thread.id !== expectedThreadId) throw Error('DIFFERENT_THREAD');
  if (!Array.isArray(thread.turns)) throw Error('THREAD_SNAPSHOT_INVALID');
  const messages: Message[] = [];
  for (const [turnIndex, rawTurn] of thread.turns.entries()) {
    const turn = obj(rawTurn), turnId = text(turn.id);
    if (!turnId || !Array.isArray(turn.items)) continue;
    const started = unixMs(turn.startedAt), completed = unixMs(turn.completedAt);
    for (const [index, rawItem] of turn.items.entries()) {
      const item = obj(rawItem), finished = !['inProgress','in_progress','running'].includes(text(item.status));
      const message = messageFromItem(item, turnId, turnIndex * 100_000 + index, started, completed) ??
        activityFromItem(item, turnId, turnIndex * 100_000 + index, finished);
      if (message) messages.push(message);
    }
  }
  const last = obj(thread.turns.at(-1));
  const running = ['inProgress','in_progress','running'].includes(text(last.status));
  const activeTurnId = running ? text(last.id) || null : null;
  return { messages: messages.map((message) =>
    running && message.turnId === activeTurnId && message.role === 'assistant' && !message.kind
      ? { ...message, complete: false } : message),
    running, activeTurnId, runningSinceMs: running ? unixMs(last.startedAt) ?? null : null };
}

export function applyNotice(previous: readonly Message[], notice: NativeNotice): Message[] {
  const p = obj(notice.params), turnId = text(p.turnId) || text(obj(p.turn).id);
  if (!turnId) return [...previous];
  const item = obj(p.item), itemId = text(p.itemId) || text(item.id);
  if (notice.method === 'turn/completed' && turnId) return previous.map((m) => m.turnId === turnId ? { ...m, complete: true } : m);
  if (!itemId) return [...previous];
  const id = turnId + ':' + itemId;
  const existing = previous.find((m) => m.id === id);
  if (notice.method === 'item/started' || notice.method === 'item/completed') {
    const finished = notice.method === 'item/completed';
    if (!finished && existing) return [...previous];
    const convert = messageFromItem({ ...item, id: itemId }, turnId, nextOrdinal(previous)) ??
      activityFromItem({ ...item, id: itemId }, turnId, nextOrdinal(previous), finished);
    return convert ? merge(previous, convert) : [...previous];
  }
  if (existing?.complete) return [...previous];
  if (notice.method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
    return merge(previous, { id, turnId, role: 'assistant', content: clip((existing?.content ?? '') + p.delta),
      ordinal: nextOrdinal(previous), complete: false });
  }
  if (notice.method === 'item/reasoning/summaryTextDelta' && typeof p.delta === 'string') {
    const index = typeof p.summaryIndex === 'number' && Number.isInteger(p.summaryIndex) && p.summaryIndex >= 0 && p.summaryIndex < 64 ? p.summaryIndex : 0;
    const parts = [...(existing?.summaryParts ?? [])];
    parts[index] = clip((parts[index] ?? '') + p.delta);
    return merge(previous, { id, turnId, role: 'assistant', kind: 'reasoning', title: '思考摘要',
      content: clip(parts.filter(Boolean).join('\n\n')), summaryParts: parts, ordinal: nextOrdinal(previous), complete: false, status: 'inProgress' });
  }
  if (notice.method === 'item/plan/delta' && typeof p.delta === 'string') {
    return merge(previous, { id, turnId, role: 'assistant', kind: 'plan', title: '计划',
      content: clip((existing?.content ?? '') + p.delta), ordinal: nextOrdinal(previous), complete: false });
  }
  if (notice.method === 'item/commandExecution/outputDelta' && typeof p.delta === 'string' && existing?.kind === 'tool') {
    return merge(previous, { ...existing, detail: clip((existing.detail ?? '') + p.delta), complete: false });
  }
  return [...previous];
}
