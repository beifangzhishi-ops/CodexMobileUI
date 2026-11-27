/** Transport-neutral task contract shared by Gateway, Android and browser. */
export type TaskSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily' | 'weekdays'; hour: number; minute: number }
  | { kind: 'weekly'; hour: number; minute: number; days: number[] }
  | { kind: 'rrule'; rule: string; startAt: string };

export type TaskInput = {
  name: string;
  prompt: string;
  projectId: string;
  schedule: TaskSchedule;
  timeZone: string;
  conversationMode: 'new' | 'resume';
  threadId: string | null;
  modelMode?: 'default' | 'none';
  model: string | null;
  effort: string | null;
  permissionMode: 'read-only' | 'workspace-write';
  workspaceMode: 'project' | 'worktree';
};

export type Task = TaskInput & {
  id: string;
  enabled: boolean;
  completed: boolean;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskRun = {
  id: string;
  taskId: string;
  state: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  finishedAt: string | null;
  threadId: string | null;
  turnId: string | null;
  reason: string | null;
  trigger: 'manual' | 'scheduled';
  seen: boolean;
  reminder?: { title: string; text: string; scheduledAt: string | null };
};
