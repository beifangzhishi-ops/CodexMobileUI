import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Check, ChevronLeft, Clock3, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { Task, TaskInput, TaskRun, TaskSchedule } from '../../shared/automation';
import type { HostId } from './types';
import type { NativeProject, NativeModel } from './nativeProtocol';

type Props = {
  hosts: readonly HostId[];
  initialHost: HostId;
  initialReminder?: { taskId: string; runId: string };
  projects: readonly NativeProject[];
  models: Record<HostId, NativeModel[]>;
  status: Record<HostId, 'connecting' | 'online' | 'offline'>;
  request: (host: HostId, method: string, params: Record<string, unknown>) => Promise<unknown>;
  onOpenThread: (host: HostId, threadId: string) => void;
  onNewChat: () => void;
};
type Mode = 'list' | 'editor' | 'details';
type Tab = 'active' | 'paused' | 'done';
const effortLabels: Record<string, string> = {
  none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高',
  max: 'Max', ultra: 'Ultra',
};
const modelValue = (model: NativeModel) => model.model ?? model.id;
const reminderOption = 'reminder:without-model';
const zone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
})();
const localDateTime = (iso: string) => {
  const value = new Date(iso);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return Number.isFinite(local.getTime()) ? local.toISOString().slice(0, 16) : '';
};
const defaultInput = (projectId: string): TaskInput => ({
  name: '', prompt: '', projectId, schedule: { kind: 'daily', hour: 9, minute: 0 },
  timeZone: zone, conversationMode: 'new', threadId: null,
  model: null, effort: null, permissionMode: 'workspace-write', workspaceMode: 'project',
});
function dataRows<T>(result: unknown): T[] {
  if (!result || typeof result !== 'object' || !('data' in result) ||
      !Array.isArray(result.data)) throw Error('INVALID_AUTOMATION_RESPONSE');
  return result.data as T[];
}
const scheduleLabel = (s: TaskSchedule) => {
  if (s.kind === 'once') return '单次 · ' + new Date(s.at).toLocaleString();
  if (s.kind === 'hourly') return '每小时 ' + String(s.minute).padStart(2, '0') + ' 分';
  if (s.kind === 'rrule') return '自定义 · ' + s.rule;
  const time = String(s.hour).padStart(2, '0') + ':' + String(s.minute).padStart(2, '0');
  if (s.kind === 'daily') return '每天 ' + time;
  if (s.kind === 'weekdays') return '工作日 ' + time;
  if (s.kind === 'weekly') return '每周 ' + s.days.join('、') + ' · ' + time;
  return time;
};

export function AutomationView({ hosts, initialHost, initialReminder, projects, models, status,
  request, onOpenThread, onNewChat }: Props) {
  const [host, setHost] = useState<HostId>(initialHost);
  const [mode, setMode] = useState<Mode>('list');
  const [tab, setTab] = useState<Tab>('active');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inbox, setInbox] = useState<TaskRun[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [openedReminder, setOpenedReminder] = useState<TaskRun | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [draft, setDraft] = useState<TaskInput>(() => defaultInput(''));
  const [clock, setClock] = useState('09:00');
  const [once, setOnce] = useState(() => localDateTime(new Date(Date.now() + 86400000).toISOString()));
  const [weekday, setWeekday] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const online = status[host] === 'online';
  const hostProjects = projects.filter((project) => project.hostId === host);
  const hostModels = models[host] ?? [];
  const draftModel = hostModels.find((model) => modelValue(model) === draft.model);
  const selectedModel = hostModels.find((model) => modelValue(model) === selected?.model);
  const reminder = draft.modelMode === 'none';
  const call = useCallback((method: string, params: Record<string, unknown> = {}) =>
    request(host, 'web/automation', { method, params }), [request, host]);

  const refresh = useCallback(async () => {
    if (!online) { setError('目标电脑未连接'); return; }
    setLoading(true);
    try {
      const [tasksData, inboxData] = await Promise.all([
        call('automation/list'), call('automation/inbox'),
      ]);
      setTasks(dataRows<Task>(tasksData));
      setInbox(dataRows<TaskRun>(inboxData));
      setError('');
    } catch {
      setError('无法读取定时任务，请检查该电脑的 Gateway 服务。');
    } finally { setLoading(false); }
  }, [online, call]);
  useEffect(() => {
    setMode('list'); setSelected(null); setTasks([]); setInbox([]);
    void refresh();
    const timer = window.setInterval(() => { if (online) void refresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [host, refresh, online]);

  useEffect(() => {
    if (!initialReminder || !online || host !== initialHost) return;
    let current = true;
    void call('automation/runs', { taskId: initialReminder.taskId }).then((data) => {
      if (!current) return;
      const run = dataRows<TaskRun>(data).find((item) => item.id === initialReminder.runId);
      if (run?.reminder) {
        setOpenedReminder(run);
        return call('automation/read', { runId: run.id }).then(refresh);
      }
      setError('找不到这条提醒记录。');
    }).catch(() => { if (current) setError('无法读取这条提醒。'); });
    return () => { current = false; };
  }, [initialReminder, initialHost, host, online, call, refresh]);

  async function mutate(method: string, params: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await call(method, params);
      setMode('list'); setSelected(null);
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setError(message === 'MODEL_NOT_FOUND' ? '所选模型在目标电脑上不可用。' :
        message === 'EFFORT_NOT_SUPPORTED' ? '所选模型不支持此思考强度。' :
        method === 'automation/create' || method === 'automation/run'
        ? '操作结果尚未确认，请先刷新核对，避免重复创建或运行。'
        : '电脑未确认操作结果，请刷新后重试。');
    } finally { setBusy(false); }
  }
  function edit(task?: Task) {
    const value = task ?? defaultInput(hostProjects[0]?.id ?? '');
    const s = value.schedule;
    setSelected(task ?? null);
    setDraft({ name: value.name, prompt: value.prompt, projectId: value.projectId,
      schedule: s, timeZone: value.timeZone, conversationMode: value.conversationMode,
      threadId: value.threadId, model: value.model, modelMode: value.modelMode, effort: value.effort,
      permissionMode: value.permissionMode, workspaceMode: value.workspaceMode });
    if ('hour' in s) setClock(String(s.hour).padStart(2, '0') + ':' + String(s.minute).padStart(2, '0'));
    else if (s.kind === 'hourly') setClock('09:' + String(s.minute).padStart(2, '0'));
    if (s.kind === 'once') setOnce(localDateTime(s.at));
    if (s.kind === 'weekly') setWeekday(s.days[0] ?? 1);
    setError(''); setMode('editor');
  }
  async function details(task: Task) {
    setSelected(task); setMode('details'); setRuns([]); setError('');
    try { setRuns(dataRows<TaskRun>(await call('automation/runs', { taskId: task.id }))); }
    catch { setError('无法读取执行历史'); }
  }
  const save = () => {
    if (!draft.name.trim() || !draft.prompt.trim() ||
        (!reminder && !hostProjects.some((project) => project.id === draft.projectId))) {
      setError(reminder ? '请填写任务名称和提醒内容。' :
        '请填写任务名称、指令，并选择当前电脑上的项目。'); return;
    }
    let schedule: TaskSchedule = draft.schedule;
    const [hour, minute] = clock.split(':').map(Number);
    if (draft.schedule.kind === 'once') {
      const timestamp = new Date(once);
      if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() <= Date.now()) {
        setError('请选择未来的执行时间'); return;
      }
      schedule = draft.schedule.at && once === localDateTime(draft.schedule.at)
        ? draft.schedule : { kind: 'once', at: timestamp.toISOString() };
    } else if (draft.schedule.kind === 'hourly') {
      schedule = { kind: 'hourly', minute };
    } else if (draft.schedule.kind === 'daily' || draft.schedule.kind === 'weekdays') {
      schedule = { kind: draft.schedule.kind, hour, minute };
    } else if (draft.schedule.kind === 'weekly') {
      schedule = { kind: 'weekly', hour, minute,
        days: weekday === draft.schedule.days[0] ? draft.schedule.days : [weekday] };
    }
    const task: TaskInput = { ...draft, name: draft.name.trim(), schedule, modelMode: 'default',
      prompt: draft.prompt.trim(), ...(reminder && {
        modelMode: 'none', projectId: '', prompt: draft.prompt, threadId: null, model: null, effort: null,
        conversationMode: 'new', permissionMode: 'read-only', workspaceMode: 'project',
      }) };
    void mutate(selected ? 'automation/update' : 'automation/create',
      selected ? { id: selected.id, patch: task } : { task });
  };
  const shown = tasks.filter((task) => tab === 'done' ? task.completed :
    tab === 'paused' ? !task.enabled && !task.completed : task.enabled && !task.completed);

  return <div className="automations-view">
    <div className="automations-toolbar">
      <strong><CalendarClock size={20}/>定时任务</strong>
      <select aria-label="选择电脑" value={host} disabled={busy}
        onChange={(event) => { setOpenedReminder(null); setHost(event.target.value as HostId); }}>
        {hosts.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <button title="刷新" aria-label="刷新任务" disabled={loading} onClick={() => { void refresh(); }}>
        <RefreshCw size={18}/></button>
      <button className="automations-create" disabled={!online} onClick={() => { setOpenedReminder(null); edit(); }}>
        <Plus size={17}/>新建
      </button>
    </div>
    {error && <p role="alert" className="automations-error">{error}</p>}
    {openedReminder?.reminder && <div className="automations-details">
      <button className="automations-back" onClick={() => setOpenedReminder(null)}>
        <ChevronLeft size={18}/>关闭提醒
      </button>
      <h2>{openedReminder.reminder.title}</h2>
      <p className="automations-prompt">{openedReminder.reminder.text}</p>
      <p>触发时间 {new Date(openedReminder.startedAt).toLocaleString()}</p>
      {openedReminder.reminder.scheduledAt && <p>
        原定时间 {new Date(openedReminder.reminder.scheduledAt).toLocaleString()}
      </p>}
    </div>}
    {mode === 'list' && <>
      {inbox.length > 0 && <div className="automations-inbox">
        {inbox.length} 条任务消息待查看
        {inbox.map((run) => <button key={run.id} onClick={() => {
          if (run.reminder) setOpenedReminder(run);
          void call('automation/read', { runId: run.id }).then(refresh)
            .catch(() => setError('无法标记为已读。'));
          if (run.threadId) onOpenThread(host, run.threadId);
        }}>{run.reminder?.title ?? run.state} · {new Date(run.startedAt).toLocaleString()}</button>)}
      </div>}
      <div className="automations-tabs">
        {(['active', 'paused', 'done'] as const).map((item) => <button key={item}
          aria-pressed={tab === item} onClick={() => setTab(item)}>
          {item === 'active' ? '运行中' : item === 'paused' ? '已暂停' : '已完成'}
        </button>)}
      </div>
      {shown.length === 0 && <p className="automations-empty">{loading ? '正在加载…' : '这里还没有任务'}</p>}
      <div className="automations-list">{shown.map((task) => <article key={task.id}>
        <button className="automations-task" onClick={() => { void details(task); }}>
          <strong>{task.name}</strong>
          <span>{scheduleLabel(task.schedule)} · {task.modelMode === 'none' ? '仅提醒' :
            hostProjects.find((p) => p.id === task.projectId)?.name ?? '项目'}</span>
          <span>{task.nextRunAt ? '下次：' + new Date(task.nextRunAt).toLocaleString() : '暂无下次执行时间'}</span>
        </button>
        <button aria-label={task.enabled ? '暂停任务' : '启用任务'} disabled={busy}
          onClick={() => { void mutate('automation/toggle', { id: task.id, enabled: !task.enabled }); }}>
          {task.enabled ? <Pause size={17}/> : <Play size={17}/>}</button>
      </article>)}</div>
    </>}
    {mode === 'editor' && <div className="automations-editor">
      <button className="automations-back" onClick={() => setMode('list')}><ChevronLeft size={18}/>返回列表</button>
      <label>任务名称<input value={draft.name} maxLength={80} disabled={busy}
        onChange={(event) => setDraft((old) => ({ ...old, name: event.target.value }))}/></label>
      <label>模型<select value={reminder ? reminderOption : draft.model ?? ''} disabled={busy} onChange={(event) => {
        const value = event.target.value;
        setDraft((old) => ({ ...old, modelMode: value === reminderOption ? 'none' : 'default',
          model: value === reminderOption ? null : value || null, effort: null }));
      }}>
        <option value="">默认模型</option>
        <option value={reminderOption}>不使用模型（仅提醒）</option>
        {draft.model && !draftModel && <option value={draft.model}>{draft.model}（不可用）</option>}
        {hostModels.map((model) => <option key={model.id} value={modelValue(model)}>{model.name}</option>)}
      </select></label>
      <label>{reminder ? '提醒内容' : '执行指令'}<textarea value={draft.prompt} maxLength={12000} rows={5} disabled={busy}
        onChange={(event) => setDraft((old) => ({ ...old, prompt: event.target.value }))}/></label>
      {!reminder && <label>所属项目<select value={draft.projectId} disabled={busy || !!draft.threadId}
        onChange={(event) => setDraft((old) => ({ ...old, projectId: event.target.value }))}>
        <option value="">请选择</option>
        {hostProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>}
      <label>重复规则<select value={draft.schedule.kind} disabled={busy}
        onChange={(event) => {
          const kind = event.target.value as TaskSchedule['kind'];
          if (kind === 'rrule') return;
          const schedule: TaskSchedule = kind === 'once' ? { kind, at: new Date(Date.now() + 86400000).toISOString() } :
            kind === 'hourly' ? { kind, minute: 0 } :
            kind === 'weekly' ? { kind, hour: 9, minute: 0, days: [1] } :
            { kind, hour: 9, minute: 0 };
          setDraft((old) => ({ ...old, schedule }));
        }}>
        <option value="daily">每天</option><option value="weekdays">工作日</option>
        <option value="weekly">每周</option><option value="hourly">每小时</option>
        <option value="once">{reminder ? '仅提醒一次' : '仅执行一次'}</option>
        {draft.schedule.kind === 'rrule' && <option value="rrule">自定义 RRULE</option>}
      </select></label>
      {draft.schedule.kind === 'once' ? <label>{reminder ? '提醒时间' : '执行时间'}<input type="datetime-local" value={once}
        onChange={(event) => setOnce(event.target.value)}/></label> :
        draft.schedule.kind !== 'rrule' && <label>{reminder ? '提醒时间' : '执行时间'}
          <input type="time" value={clock} onChange={(event) => setClock(event.target.value)}/>
        </label>}
      {draft.schedule.kind === 'weekly' && <label>星期<select value={weekday}
        onChange={(event) => setWeekday(Number(event.target.value))}>
        {['日','一','二','三','四','五','六'].map((day, i) =>
          <option key={i} value={i}>周{day}</option>)}
      </select></label>}
      {!reminder && <>
      <label>权限<select value={draft.permissionMode}
        onChange={(event) => setDraft((old) => ({ ...old,
          permissionMode: event.target.value as TaskInput['permissionMode'] }))}>
        <option value="workspace-write">工作区写入</option>
        <option value="read-only">只读</option>
      </select></label>
      <label>工作区<select value={draft.workspaceMode}
        onChange={(event) => setDraft((old) => ({ ...old,
          workspaceMode: event.target.value as TaskInput['workspaceMode'] }))}>
        <option value="project">项目目录</option><option value="worktree">独立工作树</option>
      </select></label>
      <label>思考强度<select value={draft.effort ?? ''} disabled={busy || !draftModel?.efforts.length}
        onChange={(event) => setDraft((old) => ({ ...old, effort: event.target.value || null }))}>
        <option value="">默认</option>
        {draft.effort && !draftModel?.efforts.includes(draft.effort) &&
          <option value={draft.effort}>{effortLabels[draft.effort] ?? draft.effort}（不可用）</option>}
        {draftModel?.efforts.map((effort) =>
          <option key={effort} value={effort}>{effortLabels[effort] ?? effort}</option>)}
      </select></label>
      </>}
      <button className="automations-save" disabled={busy} onClick={save}>
        <Check size={17}/>{busy ? '保存中…' : selected ? '保存任务' : '创建任务'}
      </button>
    </div>}
    {mode === 'details' && selected && <div className="automations-details">
      <button className="automations-back" onClick={() => setMode('list')}><ChevronLeft size={18}/>返回列表</button>
      <h2>{selected.name}</h2>
      <p>{scheduleLabel(selected.schedule)} · {selected.timeZone}</p>
      {selected.modelMode === 'none' ? <p>仅提醒</p> : <p>
        模型 {selectedModel?.name ?? selected.model ?? '默认'} · 思考强度 {selected.effort
          ? effortLabels[selected.effort] ?? selected.effort : '默认'}</p>}
      <p className="automations-prompt">{selected.prompt}</p>
      <div className="automations-buttons">
        <button onClick={() => edit(selected)}>编辑</button>
        <button disabled={busy} onClick={() => { void mutate('automation/run', { id: selected.id }); }}>
          <Play size={16}/>{selected.modelMode === 'none' ? '立即提醒' : '立即运行'}
        </button>
        <button disabled={busy} onClick={() => {
          if (window.confirm(selected.modelMode === 'none' ? '删除此提醒任务？' : '删除任务定义？已生成的聊天会保留。')) {
            void mutate('automation/delete', { id: selected.id });
          }
        }}><Trash2 size={16}/>删除任务</button>
      </div>
      <strong className="automations-history-title"><Clock3 size={17}/>{selected.modelMode === 'none' ? '提醒历史' : '执行历史'}</strong>
      {runs.map((run) => <button key={run.id} className="automations-run"
        onClick={() => {
          if (run.reminder) {
            setOpenedReminder(run);
            if (!run.seen) void call('automation/read', { runId: run.id }).then(refresh)
              .catch(() => setError('无法标记为已读。'));
          } else if (run.threadId) onOpenThread(host, run.threadId);
        }}>
        {run.reminder ? '已触发' : run.state} · {new Date(run.startedAt).toLocaleString()}
        {run.reason && <span> · {run.reason}</span>}
      </button>)}
      {runs.length === 0 && <p>{selected.modelMode === 'none' ? '没有提醒记录' : '没有执行记录'}</p>}
    </div>}
    {mode === 'list' && <button className="automations-new-chat" onClick={onNewChat}>返回聊天</button>}
  </div>;
}
