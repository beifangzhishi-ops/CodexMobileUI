import { resolve, dirname } from 'node:path';
import { SchedulerStore, type Task } from './scheduler.js';
import { executeScheduledTask, SchedulerNativeClient } from './schedulerRunner.js';
import { inspectGitProject } from './schedulerWorktree.js';
import type { QuotaGuardGate } from './quotaGuardState.js';

type Params = Record<string, unknown>;
const object = (value: unknown): value is Params =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

export class SchedulerService {
  private readonly store: SchedulerStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly busy = new Set<string>();
  private closed = false;

  constructor(private readonly stateFile: string, private readonly upstream: string,
    private readonly quotaGuard: QuotaGuardGate | null = null) {
    this.store = new SchedulerStore(resolve(dirname(stateFile), 'scheduler.sqlite'));
  }

  start(): void {
    if (this.timer) return;
    this.store.skipOverdue();
    this.tick();
    this.timer = setInterval(() => this.tick(), 15_000);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.store.close();
  }

  private tick(): void {
    if (this.closed) return;
    const now = new Date();
    const admission = this.quotaGuard?.admission(now.getTime());
    for (const task of this.store.list()) {
      if (task.enabled && task.nextRunAt && Date.parse(task.nextRunAt) <= now.getTime()) {
        if (admission && !admission.allowed) {
          this.store.skipGuardedOccurrence(task.id, admission.reason ?? 'QUOTA_GUARD_BLOCKED', now);
        } else if (!this.busy.has(task.id)) this.launch(task.id, 'scheduled');
        else this.store.skipBusyOccurrence(task.id, now);
      }
    }
  }

  private launch(id: string, trigger: 'manual' | 'scheduled'): ReturnType<SchedulerStore['beginRun']> {
    if (this.closed || this.busy.has(id)) throw new Error('TASK_BUSY');
    const admission = this.quotaGuard?.admission();
    if (admission && !admission.allowed) {
      throw new Error(admission.reason ?? 'QUOTA_GUARD_BLOCKED');
    }
    const run = this.store.beginRun(id, trigger);
    const task = this.store.get(id)!;
    this.busy.add(id);
    void executeScheduledTask(task, this.upstream, {
      onThread: (threadId) => {
        if (this.closed) return;
        this.store.assignThread(run.id, threadId);
        this.store.updateResumeThread(id, threadId);
      },
      onTurn: (threadId, turnId) => {
        if (!this.closed) this.store.assignThread(run.id, threadId, turnId);
      },
    }, dirname(this.stateFile), this.quotaGuard).then(() => {
      if (!this.closed) this.store.finishRun(run.id, 'completed', null);
    }).catch((error: unknown) => {
      if (this.closed) return;
      const safe = error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message : 'NATIVE_EXECUTION_FAILED';
      this.store.finishRun(run.id, 'failed', safe);
    }).finally(() => this.busy.delete(id));
    return run;
  }

  private async checkNativeSelection(task: Task): Promise<void> {
    const client = new SchedulerNativeClient(this.upstream);
    try {
      await client.connect();
      const result = await client.request('project/read', { projectId: task.projectId });
      const project = (result.project ?? result) as Params;
      if (!object(project) || project.id !== task.projectId || !Array.isArray(project.roots)
          || !project.roots.length) throw new Error('PROJECT_NOT_FOUND');
      if (task.workspaceMode === 'worktree') {
        const first = project.roots[0];
        const path = typeof first === 'string' ? first : object(first) ? first.path : null;
        if (typeof path !== 'string') throw new Error('PROJECT_ROOT_INVALID');
        await inspectGitProject(path);
      }
      if (task.model || task.effort) {
        const models = await client.request('model/list', { limit: 100 });
        const options = Array.isArray(models.data) ? models.data : [];
        const choice = options.find((entry): entry is Params => object(entry) &&
          entry.model === task.model && entry.hidden !== true);
        if (!task.model || !choice) throw new Error('MODEL_NOT_FOUND');
        if (task.effort && (!Array.isArray(choice.supportedReasoningEfforts) ||
          !choice.supportedReasoningEfforts.some((effort) =>
            object(effort) && effort.reasoningEffort === task.effort))) {
          throw new Error('EFFORT_NOT_SUPPORTED');
        }
      }
      if (task.conversationMode === 'resume' && task.threadId) {
        const thread = await client.request('thread/read', { threadId: task.threadId, includeTurns: false });
        const current = (thread.thread ?? thread) as Params;
        if (!object(current) || current.projectId !== task.projectId) {
          throw new Error('THREAD_PROJECT_MISMATCH');
        }
      }
    } finally { client.close(); }
  }

  async handle(method: string, raw: unknown): Promise<unknown> {
    if (!object(raw)) throw new Error('INVALID_PARAMS');
    const params = raw;
    const only = (...keys: string[]) => {
      if (Object.keys(params).some((key) => !keys.includes(key))) throw new Error('INVALID_PARAMS');
    };
    switch (method) {
      case 'automation/list': only(); return { data: this.store.list() };
      case 'automation/inbox': only(); return { data: this.store.unseen() };
      case 'automation/runs':
        only('taskId');
        if (!identifier(params.taskId)) throw new Error('INVALID_PARAMS');
        return { data: this.store.runs(params.taskId) };
      case 'automation/read':
        only('runId');
        if (!identifier(params.runId)) throw new Error('INVALID_PARAMS');
        this.store.markSeen(params.runId); return { ok: true };
      case 'automation/create': {
        only('task');
        // Validate and inspect the authoritative native catalog before persistence.
        const task = this.store.createDraft(params.task);
        await this.checkNativeSelection(task);
        return this.store.create(params.task);
      }
      case 'automation/update': {
        only('id', 'patch');
        if (!identifier(params.id) || this.busy.has(params.id)) throw new Error('TASK_BUSY');
        const task = this.store.previewUpdate(params.id, params.patch);
        await this.checkNativeSelection(task);
        return this.store.update(params.id, params.patch);
      }
      case 'automation/toggle':
        only('id', 'enabled');
        if (!identifier(params.id) || typeof params.enabled !== 'boolean') throw new Error('INVALID_PARAMS');
        return this.store.toggle(params.id, params.enabled);
      case 'automation/delete':
        only('id');
        if (!identifier(params.id)) throw new Error('INVALID_PARAMS');
        if (this.busy.has(params.id)) throw new Error('TASK_BUSY');
        this.store.remove(params.id); return { ok: true };
      case 'automation/run':
        only('id');
        if (!identifier(params.id)) throw new Error('INVALID_PARAMS');
        return this.launch(params.id, 'manual');
      default: throw new Error('UNKNOWN_METHOD');
    }
  }
}
