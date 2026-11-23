import { isAbsolute } from 'node:path';
import { WebSocket } from 'ws';
import type { Task } from './scheduler.js';
import { ensureTaskWorktree } from './schedulerWorktree.js';

type Json = Record<string, unknown>;
type Pending = { resolve: (value: Json) => void; reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> };

const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Json : {};

/** A private, unproxied native connection owned by the gateway scheduler. */
export class SchedulerNativeClient {
  private socket: WebSocket | null = null;
  private nextId = 0;
  private requests = new Map<number, Pending>();
  private subscribers = new Set<(method: string, params: Json) => void>();
  private disconnectListeners = new Set<() => void>();
  private closed = false;

  constructor(private readonly upstream: string) {}

  async connect(): Promise<void> {
    const ws = new WebSocket(this.upstream, { perMessageDeflate: false });
    this.socket = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('APP_SERVER_TIMEOUT')), 10_000);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (error) => { clearTimeout(timer); reject(error); });
      ws.once('close', () => { clearTimeout(timer); reject(new Error('APP_SERVER_CLOSED')); });
    });
    ws.on('message', (bytes, binary) => {
      if (binary) return;
      let payload: Json;
      try { payload = object(JSON.parse(bytes.toString())); } catch { return; }
      if (typeof payload.id === 'number' && typeof payload.method !== 'string') {
        const pending = this.requests.get(payload.id);
        if (!pending) return;
        this.requests.delete(payload.id);
        clearTimeout(pending.timer);
        if (payload.error) pending.reject(new Error('NATIVE_RPC_FAILED'));
        else pending.resolve(object(payload.result));
      } else if (typeof payload.method === 'string') {
        for (const onNotice of this.subscribers) onNotice(payload.method, object(payload.params));
        // Scheduled runs never auto-grant permissions. No full-access or approval escalation.
        if (typeof payload.id === 'number' || typeof payload.id === 'string') ws.send(JSON.stringify({ id: payload.id,
          error: { code: -32000, message: 'Unattended approval not permitted' } }));
      }
    });
    ws.on('close', () => this.failAll());
    ws.on('error', () => this.failAll());
    await this.request('initialize', {
      clientInfo: { name: 'codex_mobile_scheduler', title: 'CodexMobileUI Scheduler', version: '0.1.7' },
      capabilities: { experimentalApi: true, requiredHumanApproval: false },
    });
    ws.send(JSON.stringify({ method: 'initialized', params: {} }));
  }

  request(method: string, params: Json, timeoutMs = 25_000): Promise<Json> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.closed) {
      return Promise.reject(new Error('APP_SERVER_UNAVAILABLE'));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('NATIVE_RPC_TIMEOUT'));
      }, timeoutMs);
      this.requests.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        const request = this.requests.get(id);
        if (!request) return;
        clearTimeout(request.timer);
        this.requests.delete(id);
        reject(new Error('NATIVE_RPC_SEND_FAILED'));
      });
    });
  }

  subscribe(listener: (method: string, params: Json) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }
  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  private failAll(): void {
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('APP_SERVER_DISCONNECTED'));
    }
    this.requests.clear();
    for (const onDisconnect of this.disconnectListeners) onDisconnect();
  }

  close(): void {
    this.closed = true;
    this.failAll();
    this.subscribers.clear();
    this.disconnectListeners.clear();
    this.socket?.close();
  }
}

export type SchedulerRunCallbacks = {
  onThread: (threadId: string) => void;
  onTurn: (threadId: string, turnId: string) => void;
};

function projectRoot(response: Json, projectId: string): string {
  const project = object(response.project ?? response);
  if (project.id !== projectId || !Array.isArray(project.roots) || !project.roots.length) {
    throw new Error('PROJECT_NOT_FOUND');
  }
  const root = project.roots[0];
  const path = typeof root === 'string' ? root : object(root).path;
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('PROJECT_ROOT_INVALID');
  return path;
}

export async function executeScheduledTask(task: Task, upstream: string,
  callbacks: SchedulerRunCallbacks, stateDirectory?: string): Promise<void> {
  const native = new SchedulerNativeClient(upstream);
  try {
    await native.connect();
    const info = await native.request('project/read', { projectId: task.projectId });
    const root = projectRoot(info, task.projectId);
    const cwd = task.workspaceMode === 'worktree'
      ? await ensureTaskWorktree(root, task.id, stateDirectory ?? process.cwd()) : root;
    const permissions = task.permissionMode === 'read-only' ? ':read-only' : ':workspace';
    let threadId = task.conversationMode === 'resume' ? task.threadId : null;
    if (threadId) {
      await native.request('thread/resume', { threadId });
    } else {
      const result = await native.request('thread/start', {
        cwd, projectId: task.projectId, permissions, approvalPolicy: 'never',
        ...(task.workspaceMode === 'worktree' ? { runtimeWorkspaceRoots: [cwd] } : {}),
      });
      threadId = object(result.thread).id as string;
      if (typeof threadId !== 'string' || !threadId) throw new Error('NATIVE_THREAD_MISSING');
    }
    callbacks.onThread(threadId);
    const selectedThread = threadId;
    let settle: ((reason?: Error) => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const completed = new Promise<void>((resolve, reject) => {
      settle = (reason?: Error) => reason ? reject(reason) : resolve();
    });
    // Mark as handled even if turn/start fails before we can await completion.
    void completed.catch(() => undefined);
    const unsubscribe = native.subscribe((method, params) => {
      if (method !== 'turn/completed' || params.threadId !== selectedThread) return;
      const turn = object(params.turn);
      const status = typeof turn.status === 'string' ? turn.status : '';
      if (status === 'completed') settle?.();
      else settle?.(new Error('TURN_' + (status || 'UNCONFIRMED').toUpperCase()));
    });
    const unsubscribeDisconnect = native.onDisconnect(() =>
      settle?.(new Error('APP_SERVER_DISCONNECTED')));
    timer = setTimeout(() => settle?.(new Error('TURN_COMPLETION_TIMEOUT')), 30 * 60_000);
    try {
      // Subscribe before turn/start: completion can arrive before the RPC acknowledgement.
      const result = await native.request('turn/start', {
        threadId: selectedThread, input: [{ type: 'text', text: task.prompt }],
        ...(task.model ? { model: task.model } : {}),
        ...(task.effort ? { effort: task.effort } : {}),
        permissions, approvalPolicy: 'never', cwd,
      });
      const turnId = object(result.turn).id;
      if (typeof turnId !== 'string' || !turnId) throw new Error('NATIVE_TURN_MISSING');
      callbacks.onTurn(selectedThread, turnId);
      await completed;
    } finally {
      if (timer) clearTimeout(timer);
      unsubscribe();
      unsubscribeDisconnect();
    }
  } finally {
    native.close();
  }
}
