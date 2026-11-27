import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TaskSchedule, TaskInput, Task, TaskRun } from '../shared/automation.js';
import { nextCustomOccurrence, parseTaskRrule } from './schedulerRrule.js';
export type { TaskSchedule, TaskInput, Task, TaskRun } from '../shared/automation.js';

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const str = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);

const hhmm = (h: unknown, m: unknown): boolean =>
  Number.isInteger(h) && Number(h) >= 0 && Number(h) <= 23 &&
  Number.isInteger(m) && Number(m) >= 0 && Number(m) <= 59;

export function validateTaskInput(value: unknown): TaskInput {
  if (!plain(value) || !plain(value.schedule)) throw new Error('INVALID_TASK');
  const accepted = ['name', 'prompt', 'projectId', 'schedule', 'timeZone',
    'conversationMode', 'threadId', 'model', 'modelMode', 'effort', 'permissionMode', 'workspaceMode'];
  if (Object.keys(value).some((key) => !accepted.includes(key))) throw new Error('INVALID_TASK');
  const reminder = value.modelMode === 'none';
  if (!str(value.name, 80) || !value.name.trim() ||
      !str(value.prompt, 12000) || !value.prompt.trim() ||
      (!str(value.projectId, 200) && !(reminder && value.projectId === '')) ||
      !str(value.timeZone, 100) ||
      (value.modelMode !== undefined && value.modelMode !== 'default' && !reminder) ||
      (reminder && (value.model !== null || value.effort !== null || value.threadId !== null ||
        value.conversationMode !== 'new' || value.workspaceMode !== 'project' ||
        value.permissionMode !== 'read-only' || value.projectId !== '')) ||
      !['new', 'resume'].includes(String(value.conversationMode)) ||
      !['project', 'worktree'].includes(String(value.workspaceMode)) ||
      !['read-only', 'workspace-write'].includes(String(value.permissionMode)) ||
      !(value.threadId === null || str(value.threadId, 200)) ||
      !(value.model === null || str(value.model, 100)) ||
      !(value.effort === null || str(value.effort, 40)) ||
      (value.conversationMode === 'new' && value.threadId !== null)) {
    throw new Error('INVALID_TASK');
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(value.timeZone) }); }
  catch { throw new Error('INVALID_TIME_ZONE'); }
  const s = value.schedule;
  if (s.kind === 'once') {
    if (Object.keys(s).some((key) => !['kind', 'at'].includes(key)) ||
        typeof s.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s.at) ||
        !Number.isFinite(Date.parse(s.at))) throw new Error('INVALID_SCHEDULE');
  } else if (s.kind === 'hourly') {
    if (Object.keys(s).some((key) => !['kind', 'minute'].includes(key)) ||
        !Number.isInteger(s.minute) || Number(s.minute) < 0 || Number(s.minute) > 59) {
      throw new Error('INVALID_SCHEDULE');
    }
  } else if (s.kind === 'daily' || s.kind === 'weekdays' || s.kind === 'weekly') {
    if (!hhmm(s.hour, s.minute) ||
        Object.keys(s).some((key) => !['kind', 'hour', 'minute', ...(s.kind === 'weekly' ? ['days'] : [])].includes(key))) {
      throw new Error('INVALID_SCHEDULE');
    }
    if (s.kind === 'weekly' && (!Array.isArray(s.days) || !s.days.length ||
      s.days.length > 7 || new Set(s.days).size !== s.days.length ||
      s.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
      throw new Error('INVALID_SCHEDULE');
    }
  } else if (s.kind === 'rrule') {
    if (Object.keys(s).some((key) => !['kind', 'rule', 'startAt'].includes(key)) ||
        typeof s.rule !== 'string' || typeof s.startAt !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s.startAt) ||
        !Number.isFinite(Date.parse(s.startAt))) throw new Error('INVALID_SCHEDULE');
    parseTaskRrule(s.rule);
  } else throw new Error('INVALID_SCHEDULE');
  return value as TaskInput;
}

/** Compute in the task's own time zone; minute scanning handles half-hour offsets and DST. */
export function nextOccurrence(schedule: TaskSchedule, timeZone: string, after: Date): string | null {
  if (schedule.kind === 'once') return Date.parse(schedule.at) > after.getTime() ? schedule.at : null;
  if (schedule.kind === 'rrule') return nextCustomOccurrence(schedule.rule, schedule.startAt, timeZone, after);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
  const weekdayIndex: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const first = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset <= 8 * 24 * 60; offset++) {
    const candidate = new Date(first + offset * 60_000);
    const parts = Object.fromEntries(fmt.formatToParts(candidate).map((part) => [part.type, part.value]));
    const hour = Number(parts.hour) % 24;
    const minute = Number(parts.minute);
    const day = weekdayIndex[parts.weekday];
    if (schedule.kind === 'hourly' ? minute === schedule.minute
      : hour === schedule.hour && minute === schedule.minute &&
        (schedule.kind === 'daily' || schedule.kind === 'weekdays' && day >= 1 && day <= 5 ||
          schedule.kind === 'weekly' && schedule.days.includes(day))) {
      return candidate.toISOString();
    }
  }
  return null;
}

function taskOf(row: { json: unknown }): Task { return JSON.parse(String(row.json)) as Task; }

export class SchedulerStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, started_at TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, started_at DESC);`);
    // A process restart cannot prove whether a submitted native turn completed.
    for (const row of this.db.prepare('SELECT json FROM runs').all() as { json: unknown }[]) {
      const run = JSON.parse(String(row.json)) as TaskRun;
      if (run.state === 'running') this.finishRun(run.id, 'interrupted', 'GATEWAY_RESTARTED');
    }
  }

  close(): void { this.db.close(); }
  list(): Task[] {
    return (this.db.prepare('SELECT json FROM tasks').all() as { json: unknown }[])
      .map(taskOf).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(id: string): Task | null {
    const row = this.db.prepare('SELECT json FROM tasks WHERE id=?').get(id) as { json: unknown } | undefined;
    return row ? taskOf(row) : null;
  }
  private save(task: Task): Task {
    this.db.prepare('INSERT INTO tasks(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
      .run(task.id, JSON.stringify(task));
    return task;
  }
  createDraft(input: unknown, now = new Date()): Task {
    const data = validateTaskInput(input);
    const next = nextOccurrence(data.schedule, data.timeZone, now);
    if (!next) throw new Error('SCHEDULE_IN_PAST');
    return { ...data, id: randomUUID(), enabled: true, completed: false,
      nextRunAt: next, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  }
  create(input: unknown, now = new Date()): Task {
    if (this.list().length >= 200) throw new Error('TASK_LIMIT');
    return this.save(this.createDraft(input, now));
  }
  previewUpdate(id: string, patch: unknown, now = new Date()): Task {
    const prior = this.get(id);
    if (!prior) throw new Error('TASK_NOT_FOUND');
    if (!plain(patch)) throw new Error('INVALID_TASK');
    const input = validateTaskInput({
      ...Object.fromEntries(Object.keys(prior).filter((key) => !['id', 'enabled', 'completed',
        'nextRunAt', 'createdAt', 'updatedAt'].includes(key)).map((key) => [key, prior[key as keyof Task]])),
      ...patch,
    });
    const next = nextOccurrence(input.schedule, input.timeZone, now);
    return { ...prior, ...input, completed: !next, enabled: !!next && prior.enabled,
      nextRunAt: next, updatedAt: now.toISOString() };
  }
  update(id: string, patch: unknown, now = new Date()): Task {
    return this.save(this.previewUpdate(id, patch, now));
  }
  toggle(id: string, enabled: boolean, now = new Date()): Task {
    const prior = this.get(id);
    if (!prior) throw new Error('TASK_NOT_FOUND');
    const next = enabled ? nextOccurrence(prior.schedule, prior.timeZone, now) : prior.nextRunAt;
    if (enabled && !next) throw new Error('SCHEDULE_IN_PAST');
    return this.save({ ...prior, enabled, completed: false, nextRunAt: next,
      updatedAt: now.toISOString() });
  }
  /** Never replay old scheduled triggers after machine/network downtime. */
  skipOverdue(now = new Date(), graceMs = 60_000): void {
    for (const task of this.list()) {
      if (task.modelMode === 'none' || !task.enabled || !task.nextRunAt ||
          Date.parse(task.nextRunAt) >= now.getTime() - graceMs) continue;
      this.skipOccurrence(task, 'MISSED_WHILE_OFFLINE', now);
    }
  }
  skipBusyOccurrence(id: string, now = new Date()): void {
    const task = this.get(id);
    if (task && task.enabled && task.nextRunAt && Date.parse(task.nextRunAt) <= now.getTime()) {
      this.skipOccurrence(task, 'MISSED_WHILE_RUNNING', now);
    }
  }
  /** A protected quota period is a missed occurrence, never backlogged work. */
  skipGuardedOccurrence(id: string, reason: string, now = new Date()): void {
    const task = this.get(id);
    if (task && task.enabled && task.nextRunAt && Date.parse(task.nextRunAt) <= now.getTime()) {
      this.skipOccurrence(task, reason, now);
    }
  }
  private skipOccurrence(task: Task, reason: string, now: Date): void {
    const run: TaskRun = { id: randomUUID(), taskId: task.id, state: 'interrupted',
      startedAt: now.toISOString(), finishedAt: now.toISOString(), threadId: null,
      turnId: null, reason, trigger: 'scheduled', seen: false };
    this.writeRun(run);
    const next = nextOccurrence(task.schedule, task.timeZone, now);
    this.save({ ...task, enabled: !!next, completed: !next, nextRunAt: next,
      updatedAt: now.toISOString() });
  }
  remove(id: string): void {
    if (!this.get(id)) throw new Error('TASK_NOT_FOUND');
    this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
    // Keep run history (including real Codex thread IDs) available for audit.
  }
  runs(taskId: string): TaskRun[] {
    return (this.db.prepare('SELECT json FROM runs WHERE task_id=? ORDER BY started_at DESC LIMIT 100')
      .all(taskId) as { json: unknown }[]).map((row) => JSON.parse(String(row.json)) as TaskRun);
  }
  unseen(): TaskRun[] {
    return (this.db.prepare('SELECT json FROM runs ORDER BY started_at DESC LIMIT 500')
      .all() as { json: unknown }[]).map((row) => JSON.parse(String(row.json)) as TaskRun)
      .filter((run) => !run.seen && run.state !== 'running');
  }
  reminderEvents(after: number, now = new Date()): { cursor: number; run: TaskRun }[] {
    const cutoff = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const rows = this.db.prepare(`SELECT rowid AS cursor, json FROM runs
      WHERE rowid > ? AND started_at >= ? AND json_type(json, '$.reminder') = 'object'
      ORDER BY rowid LIMIT 100`).all(after, cutoff) as { cursor: number; json: string }[];
    return rows.map(({ cursor, json }) => ({ cursor, run: JSON.parse(json) as TaskRun }));
  }
  markSeen(runId: string): void {
    const row = this.db.prepare('SELECT json FROM runs WHERE id=?').get(runId) as { json: unknown } | undefined;
    if (!row) throw new Error('RUN_NOT_FOUND');
    const run = JSON.parse(String(row.json)) as TaskRun;
    this.writeRun({ ...run, seen: true });
  }
  private writeRun(run: TaskRun): void {
    this.db.prepare('INSERT INTO runs(id,task_id,started_at,json) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json')
      .run(run.id, run.taskId, run.startedAt, JSON.stringify(run));
  }
  beginRun(id: string, trigger: 'manual' | 'scheduled', now = new Date()): TaskRun {
    const task = this.get(id);
    if (!task) throw new Error('TASK_NOT_FOUND');
    if (this.runs(id).some((run) => run.state === 'running')) throw new Error('TASK_BUSY');
    const reminder = task.modelMode === 'none';
    const at = now.toISOString();
    const run: TaskRun = { id: randomUUID(), taskId: id, state: reminder ? 'completed' : 'running',
      startedAt: at, finishedAt: reminder ? at : null, threadId: null, turnId: null,
      reason: null, trigger, seen: false };
    if (reminder) run.reminder = { title: task.name, text: task.prompt,
      scheduledAt: trigger === 'scheduled' ? task.nextRunAt : null };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.writeRun(run);
      if (trigger === 'scheduled') {
        const next = nextOccurrence(task.schedule, task.timeZone, now);
        this.save({ ...task, nextRunAt: next, completed: !next,
          enabled: !!next && task.enabled, updatedAt: at });
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return run;
  }
  assignThread(runId: string, threadId: string, turnId?: string): void {
    const row = this.db.prepare('SELECT json FROM runs WHERE id=?').get(runId) as { json: unknown } | undefined;
    if (!row) throw new Error('RUN_NOT_FOUND');
    const run = JSON.parse(String(row.json)) as TaskRun;
    this.writeRun({ ...run, threadId, turnId: turnId ?? run.turnId });
  }
  updateResumeThread(taskId: string, threadId: string): void {
    const task = this.get(taskId);
    if (task && task.conversationMode === 'resume' && !task.threadId) {
      this.save({ ...task, threadId, updatedAt: new Date().toISOString() });
    }
  }
  finishRun(id: string, state: 'completed' | 'failed' | 'interrupted', reason: string | null): void {
    const row = this.db.prepare('SELECT json FROM runs WHERE id=?').get(id) as { json: unknown } | undefined;
    if (!row) throw new Error('RUN_NOT_FOUND');
    const run = JSON.parse(String(row.json)) as TaskRun;
    this.writeRun({ ...run, state, reason, finishedAt: new Date().toISOString() });
  }
}
