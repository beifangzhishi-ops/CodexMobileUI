import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowUp, Archive, Check, ChevronDown, ChevronRight, Clock3, Copy, Ellipsis,
  FileText, Folder, GitBranch, Hand, Image, ListTodo, Menu, Monitor, RefreshCw, Square,
  Moon, Paperclip, PanelLeftClose, PanelLeftOpen, Pin,
  Plus, Search, Settings, ShieldCheck, SquarePen, Sun, Target, Trash2, X,
} from 'lucide-react';
import { hosts } from './types';
import type { Conversation, HostId } from './types';
import { useLiveCodex } from './useLiveCodex';
import type { PermissionMode, FollowUpMode } from './useLiveCodex';
import { copyToClipboard } from './browserHelpers';

type Popup = 'host' | 'project' | 'account' | 'add' | 'permission' | 'model' | 'options' | 'recent' | null;
type Theme = 'dark' | 'light';
type ViewMode = 'chat' | 'tasks';
type IconProps = { size?: number; className?: string };

// Exact board-and-pen silhouette from the current native ReferenceIcons design.
function ComposeIcon({ size = 21, className }: IconProps) {
  return <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.8 4.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <path d="m9.5 14.5 1.5-4.2L19 2.5a2 2 0 0 1 2.8 2.8l-8 8-4.3 1.2z" />
  </svg>;
}

function mobileLayout() { return window.matchMedia('(max-width: 800px)').matches; }
function dateLabel(ts: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return ts >= today.getTime() ? '今天' : ts >= today.getTime() - 86400000 ? '昨天' : '更早';
}
function StatusMark({ status }: { status: Conversation['status'] }) {
  if (status === 'idle') return null;
  return <span className={'status-dot ' + status} title={status === 'running' ? '正在执行' : '未读消息'} />;
}

export default function DesktopApp() {
  const live = useLiveCodex();
  const { conversations, projects } = live;
  const getProjectName = (id: string | null, hostId?: HostId) =>
    projects.find((p) => p.id === id && (!hostId || p.hostId === hostId))?.name ?? null;
  const [activeId, setActiveId] = useState<string | null>(null);
  const conversationKey = (hostId: HostId, id: string) => hostId + ':' + id;
  const [newHost, setNewHost] = useState<HostId>('6v');
  const [newProject, setNewProject] = useState<string | null>(null);
  const [hostFilter, setHostFilter] = useState<'all' | HostId>('all');
  const [hostCollapsed, setHostCollapsed] = useState<HostId[]>([]);
  const [openedProjects, setOpenedProjects] = useState<string[]>([]);
  const [showAllRecent, setShowAllRecent] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sidebarOpen, setSidebarOpen] = useState(!mobileLayout());
  const [popup, setPopup] = useState<Popup>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('chat');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const sendBusy = useRef(false);
  const [plan, setPlan] = useState(false);
  const [goal, setGoal] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const [goalEditor, setGoalEditor] = useState(false);
  const [goalWorking, setGoalWorking] = useState(false);
  const [modelByHost, setModelByHost] = useState<Record<HostId, string>>({ '6v': '', noha: '' });
  const [effortByHost, setEffortByHost] = useState<Record<HostId, string>>({ '6v': '', noha: '' });
  const [permission, setPermission] = useState<PermissionMode>('default');
  const [followUpMode, setFollowUpMode] = useState<FollowUpMode>(() =>
    localStorage.getItem('codex-web-follow-up') === 'queue' ? 'queue' : 'steer');
  const [workingQueue, setWorkingQueue] = useState<string | null>(null);
  const [elapsedTick, setElapsedTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem('codex-web-visual-theme') === 'light' ? 'light' : 'dark');
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = conversations.find((item) => conversationKey(item.hostId, item.id) === activeId) ?? null;
  const currentHost = active?.hostId ?? newHost;
  const currentProject = active?.project ?? newProject;
  const draftKey = active ? 'thread:' + conversationKey(active.hostId, active.id) :
    'new:' + newHost + ':' + (newProject ?? 'none');
  const draft = drafts[draftKey] ?? '';
  const availableModels = live.models[currentHost];
  const selectedModel = availableModels.find((item) => item.id === modelByHost[currentHost]) ??
    availableModels.find((item) => item.isDefault) ?? availableModels[0];
  const availableEfforts = selectedModel?.efforts ?? [];
  const effortLabels: Record<string, string> = { minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: 'Max', ultra: 'Ultra' };
  const effectiveEffort = availableEfforts.includes(effortByHost[currentHost])
    ? effortByHost[currentHost] : selectedModel?.defaultEffort ?? '';
  const activeGoal = active ? live.goals[currentHost + ':' + active.id] : null;
  const activeQueue = active ? live.queues[currentHost + ':' + active.id] ?? [] : [];
  const displayedGoal = active ? activeGoal?.objective ?? '' : goal;
  const isRunning = active?.running === true;
  const permissionLabels: Record<PermissionMode, string> = {
    default: '默认权限', 'auto-review': '自动审查', 'read-only': '只读',
    'full-access': '完整访问权限', custom: '自定义（config.toml）',
  };

  const recents = useMemo(() => [...conversations].filter((item) =>
    (hostFilter === 'all' || item.hostId === hostFilter) &&
    Boolean(item.archived) === showArchived &&
    (showAllRecent || !item.project || showArchived)
  ).sort((a, b) => Number(pinnedIds.includes(conversationKey(b.hostId, b.id))) -
    Number(pinnedIds.includes(conversationKey(a.hostId, a.id))) ||
    b.updatedAt - a.updatedAt), [conversations, hostFilter, showAllRecent, showArchived, pinnedIds]);
  const searchResults = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return [...conversations].filter((item) =>
      !term || item.title.toLocaleLowerCase().includes(term) || item.hostId.includes(term) ||
      item.messages.some((message) => message.content.toLocaleLowerCase().includes(term))
    ).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [query, conversations]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('codex-web-visual-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101010' : '#ffffff');
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);
  useEffect(() => { localStorage.setItem('codex-web-follow-up', followUpMode); }, [followUpMode]);
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setElapsedTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setQuery(''); setSearchOpen(true); setPopup(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault(); createNewChat();
      }
      if (e.key === 'Escape') { setSearchOpen(false); setPopup(null); setGoalEditor(false); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  function closeOnMobile() { if (mobileLayout()) setSidebarOpen(false); }
  function createNewChat(host = newHost, project: string | null = null) {
    setNewHost(host); setNewProject(project); setActiveId(null); setView('chat');
    setAttachments([]); setPopup(null); setGoal(''); setPlan(false); closeOnMobile();
    window.setTimeout(() => composeRef.current?.focus(), 0);
  }
  function chooseConversation(hostId: HostId, id: string) {
    const item = conversations.find((c) => c.hostId === hostId && c.id === id);
    if (!item) return;
    setActiveId(conversationKey(hostId, id)); setNewHost(item.hostId); setNewProject(item.project);
    setView('chat'); setPopup(null); setSearchOpen(false); setAttachments([]);
    void live.select(item.hostId, id).catch(() => setNotice('读取该电脑的实际聊天记录失败，请检查连接后刷新'));
    closeOnMobile();
  }
  function toggle<T>(items: T[], item: T, setter: (items: T[]) => void) {
    setter(items.includes(item) ? items.filter((value) => value !== item) : [...items, item]);
  }
  function send() {
    if (sendBusy.current) return;
    if (live.status[currentHost] !== 'online') { setNotice('电脑尚未连接，消息仍保留在输入框'); return; }
    const value = draft.trim();
    if (!value) {
      if (attachments.length) setNotice('附件仅显示名称，当前无法上传');
      return;
    }
    if (attachments.length) { setNotice('真实附件上传尚未接入，请先移除附件'); return; }
    sendBusy.current = true;
    setSubmitting(true);
    void live.send(currentHost, active?.id ?? null, currentProject, value, {
      model: selectedModel?.id, effort: effectiveEffort || undefined,
      permissionMode: permission, plan, goal: active ? undefined : goal, followUpMode,
      onCreated: (threadId) => {
        setActiveId(conversationKey(currentHost, threadId));
        setDrafts((items) => ({ ...items, ['thread:' + conversationKey(currentHost, threadId)]: value }));
      },
    }).then((result) => {
        setActiveId(conversationKey(currentHost, result.threadId));
        setDrafts((items) => ({ ...items, [draftKey]: '',
          ['thread:' + conversationKey(currentHost, result.threadId)]: '' }));
        if (!active) setGoal('');
        setPopup(null);
        setNotice(result.queued ? '消息已进入 App Server 的真实队列'
          : result.goalFailed ? '消息已发送，但目标设置失败，请单独重试' : 'Codex 已确认接收请求');
      }).catch(() => setNotice('服务器未确认提交结果，草稿已保留；请先刷新历史记录，不要直接重发'))
      .finally(() => { sendBusy.current = false; setSubmitting(false); });
  }
  function stopTurn() {
    if (!active?.activeTurnId || submitting) return;
    void live.interrupt(active.hostId, active.id).then(() => setNotice('已发送停止请求'))
      .catch(() => setNotice('停止状态未确认，请刷新核对'));
  }
  function selectPermission(mode: PermissionMode) {
    if (isRunning || submitting) { setNotice('当前轮次运行中，请在下一轮切换权限'); return; }
    const profile = mode === 'default' || mode === 'auto-review' ? ':workspace' :
      mode === 'read-only' ? ':read-only' : mode === 'full-access' ? ':danger-full-access' : null;
    if (profile && !live.permissions[currentHost].some((p) => p.id === profile && p.allowed)) {
      setNotice('电脑的原生权限配置未允许此选项');
      return;
    }
    if (mode === 'full-access' && !window.confirm('完整访问权限允许 Codex 在对应电脑上执行高风险操作。确认在后续消息中使用？')) return;
    if (mode === 'custom' && active) setNotice('当前对话可能保留此前的权限覆盖；建议新建对话后选择自定义');
    setPermission(mode); setPopup(null);
  }
  function saveGoal() {
    const objective = goalDraft.trim();
    if (!objective || Array.from(objective).length > 4000) { setNotice('目标需要 1–4000 字'); return; }
    if (!active) { setGoal(objective); setGoalEditor(false); return; }
    if (goalWorking) return;
    setGoalWorking(true);
    void live.setGoal(active.hostId, active.id, objective).then(() => setGoalEditor(false))
      .catch(() => setNotice('服务器未确认目标更新，请刷新核对'))
      .finally(() => setGoalWorking(false));
  }
  function clearCurrentGoal() {
    if (!active) { setGoal(''); setGoalEditor(false); return; }
    if (goalWorking) return;
    setGoalWorking(true);
    void live.clearGoal(active.hostId, active.id).then(() => setGoalEditor(false))
      .catch(() => setNotice('服务器未确认清除目标'))
      .finally(() => setGoalWorking(false));
  }
  function handleEnter(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  }
  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    e.target.value = '';
    setNotice('网页端真实附件上传尚未接入；不会读取或发送文件');
  }
  function conversationRow(item: Conversation, nested = false) {
    return <button key={conversationKey(item.hostId,item.id)} className={'conversation-row' + (nested ? ' nested' : '') +
      (activeId === conversationKey(item.hostId,item.id) ? ' is-selected' : '')}
      onClick={() => chooseConversation(item.hostId,item.id)}>
      <span className="conversation-name">{pinnedIds.includes(conversationKey(item.hostId,item.id)) && <Pin size={12} />} {item.title}</span>
      <span className="conversation-end">{!nested && <span className="conversation-host">{item.hostId}</span>}<StatusMark status={item.status} /></span>
    </button>;
  }
  function actionForCurrent(action: 'pin' | 'archive' | 'delete' | 'copy' | 'fork') {
    if (!active) return;
    if (action === 'copy') {
      void copyToClipboard(active.id).then(() => setNotice('已复制对话 ID'))
        .catch(() => setNotice('浏览器不允许复制，请检查剪贴板权限'));
    }
    if (action === 'pin') toggle(pinnedIds, conversationKey(active.hostId,active.id), setPinnedIds);
    if (action === 'archive') {
      void live.request(active.hostId, 'thread/archive', { threadId: active.id }).then(() => {
        createNewChat(active.hostId);
        void live.refresh(active.hostId);
      }).catch(() => setNotice('归档结果不确定，请刷新该电脑的聊天记录核对'));
    }
    if (action === 'delete') {
      setNotice('真实删除操作尚未启用，请在移动端管理该会话');
    }
    if (action === 'fork') {
      setNotice('真实分支需要选择原始 turn，网页端尚未启用');
    }
    setPopup(null);
  }

  return <div className={'app-shell' + (sidebarOpen ? ' sidebar-is-open' : ' sidebar-is-closed')}>
    {sidebarOpen && <button aria-label="关闭侧边栏" className="mobile-scrim" onClick={() => setSidebarOpen(false)} />}
    <aside className="sidebar-rail" aria-label="电脑和会话导航">
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <strong className="app-wordmark">CodexMobile</strong>
          <button className="circle-tool sidebar-search" aria-label="搜索" title="搜索聊天 (Ctrl+K)" onClick={() => { setQuery(''); setSearchOpen(true); }}><Search size={23} /></button>
        </div>
        <div className="sidebar-scroll">
          <div className="sidebar-main-actions">
            <div className="filter-wrap">
              <button className="host-filter" aria-expanded={popup === 'host'} onClick={() => setPopup(popup === 'host' ? null : 'host')}>
                <Monitor size={19} /><span>{hostFilter === 'all' ? '全部电脑' : hostFilter}</span><ChevronDown size={16} />
              </button>
              {popup === 'host' && <div className="popover host-filter-popover"><span className="popover-heading">筛选电脑</span>
                {(['all', ...hosts.map((host) => host.id)] as ('all' | HostId)[]).map((id) =>
                  <button key={id} onClick={() => { setHostFilter(id); setPopup(null); }}><Monitor size={16}/>{id === 'all' ? '全部电脑' : id}{hostFilter === id && <Check size={16} className="check-icon" />}</button>)}
              </div>}
            </div>
            <button className="task-row" onClick={() => { setView('tasks'); setPopup(null); closeOnMobile(); }}><Clock3 size={20} /><span>定时任务</span></button>
            <div className="section-header"><span>项目</span><button aria-label="新建项目" title="创建项目" onClick={() => setNotice('网页端创建项目暂未开放；可以在移动端创建后刷新')}><Plus size={21}/></button></div>
            {hosts.filter((host) => hostFilter === 'all' || host.id === hostFilter).map((host) => {
              const collapsed = hostCollapsed.includes(host.id);
              return <div className="host-tree" key={host.id}>
                <button className="tree-host" onClick={() => toggle(hostCollapsed, host.id, setHostCollapsed)} aria-expanded={!collapsed}>
                  <ChevronRight size={17} className={collapsed ? '' : 'chevron-open'} />
                  <Monitor size={19} /><strong>{host.displayName}</strong><span className={'host-demo-dot ' + live.status[host.id]} title={'连接状态：' + live.status[host.id]} />
                </button>
                {!collapsed && <div className="tree-projects">{projects.filter((p) => p.hostId === host.id).map((p) => {
                  const expanded = openedProjects.includes(p.id);
                  const children = conversations.filter((c) => c.project === p.id && c.hostId === host.id && !c.archived);
                  return <div className="tree-project" key={p.id}>
                    <div className="project-line">
                      <button className="project-disclosure" aria-label={(expanded ? '收起 ' : '展开 ') + p.name} onClick={() => toggle(openedProjects, p.id, setOpenedProjects)}><ChevronRight size={17} className={expanded ? 'chevron-open' : ''}/></button>
                      <button className="project-name" onClick={() => toggle(openedProjects, p.id, setOpenedProjects)}><Folder size={19}/><span>{p.name}</span></button>
                      <button className="project-new" title={'在 ' + p.name + ' 新建聊天'} aria-label={'在 ' + p.name + ' 新建聊天'} onClick={() => createNewChat(host.id, p.id)}><Plus size={17}/></button>
                    </div>
                    {expanded && <div className="nested-conversations">{children.length ? children.map((c) => conversationRow(c, true)) :
                      <button className="empty-project" onClick={() => createNewChat(host.id, p.id)}>＋ 新建项目聊天</button>}</div>}
                  </div>;
                })}</div>}
              </div>;
            })}
            <div className="section-header recent-header"><span>{showArchived ? '已归档对话' : '最近对话'}</span>
              <button aria-label="刷新所有电脑的会话" title="刷新所有电脑的会话" onClick={() => {
                void Promise.allSettled(hosts.map((h) => live.refresh(h.id))).then(() => setNotice('已请求两台电脑刷新列表'));
              }}><RefreshCw size={17}/></button>
              <button aria-label="最近对话设置" title="最近对话设置" onClick={() => setPopup(popup === 'recent' ? null : 'recent')}><Settings size={20} /></button>
            </div>
            {popup === 'recent' && <div className="recent-settings">
              <label><input type="checkbox" checked={showAllRecent} onChange={(e) => setShowAllRecent(e.target.checked)} />显示项目中的对话</label>
              <label><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />查看归档对话</label>
            </div>}
            {recents.length === 0 && <div className="empty-recents">{Object.values(live.status).some((s) => s === 'connecting') ? '正在从电脑读取会话…' : '暂无真实会话'}</div>}
            {recents.slice(0, 16).map((item) => conversationRow(item))}
            {recents.length > 16 && <button className="more-recents" onClick={() => setNotice('最近对话只显示前 16 条；可使用搜索查找其他会话')}>查看更多<ChevronDown size={14}/></button>}
          </div>
        </div>
        <div className="sidebar-footer">
          <button className="new-chat-button" onClick={() => createNewChat()}><ComposeIcon size={22}/><span>聊天</span></button>
          <button className="profile-button" aria-label="设置" title="设置" onClick={() => setPopup(popup === 'account' ? null : 'account')}><span className="profile-mark">C</span></button>
          {popup === 'account' && <div className="popover account-popover"><span className="popover-heading">Codex 工作台 · 视觉原型</span>
            <button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setPopup(null); }}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}切换至{theme === 'dark' ? '浅色' : '深色'}模式</button>
            <button onClick={() => { setNotice('真实设备连接与设置尚未接入'); setPopup(null); }}><Settings size={17}/>电脑与设置</button>
          </div>}
        </div>
      </div>
    </aside>
    <main className="main-panel">
      <header className="topbar">
        <div className="topbar-left">
          <button className="top-icon" title={sidebarOpen ? '收起侧栏' : '展开侧栏'} aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'} onClick={() => setSidebarOpen((open) => !open)}>
            {sidebarOpen ? <PanelLeftClose size={21}/> : <PanelLeftOpen size={21}/>}
          </button>
          <div className="top-title">{view === 'tasks' ? '定时任务' : getProjectName(currentProject, currentHost) ?? (active ? active.title : 'Codex')}<span className="title-secondary">{view === 'chat' ? ' / ' + currentHost : ''}</span></div>
        </div>
        <div className="topbar-right">
          <span className="preview-tag"><span className={'preview-dot ' + live.status[currentHost]} />{live.status[currentHost] === 'online' ? '已连接 ' + currentHost : live.status[currentHost] === 'connecting' ? '连接中' : '未连接 ' + currentHost}</span>
          {view === 'chat' && <button className="top-icon top-more" aria-label="对话菜单" title="对话菜单" onClick={() => setPopup(popup === 'options' ? null : 'options')}><Ellipsis size={22}/></button>}
          {popup === 'options' && <div className="popover options-popover">
            <span className="popover-heading">当前会话</span>
            {active ? <>
              <button onClick={() => actionForCurrent('copy')}><Copy size={16}/>复制对话 ID</button>
              <button onClick={() => actionForCurrent('pin')}><Pin size={16}/>{pinnedIds.includes(conversationKey(active.hostId,active.id)) ? '取消置顶' : '置顶'}</button>
              <button onClick={() => actionForCurrent('fork')}><GitBranch size={16}/>分支到新聊天</button>
              <button onClick={() => actionForCurrent('archive')}><Archive size={16}/>归档</button>
              <button className="danger-action" onClick={() => actionForCurrent('delete')}><Trash2 size={16}/>删除</button>
            </> : <button onClick={() => { setNotice('请先打开一条演示会话'); setPopup(null); }}><ComposeIcon size={16}/>尚无当前会话</button>}
          </div>}
        </div>
      </header>

      {view === 'tasks' ? <div className="task-screen"><Clock3 size={29}/><h1>定时任务</h1><p>布局已预留。实际任务列表与创建功能将在接入 App Server 后显示。</p><button onClick={() => createNewChat()}><ComposeIcon size={17}/>返回聊天</button></div> :
        <div className={'chat-region' + (active ? ' has-conversation' : ' is-landing')}>
          {active ? <div className="message-scroller" key={active.hostId + active.id}><div className="messages-wrap">
            <div className="chat-context"><span><Monitor size={13}/>{active.hostId}</span>{active.project && <span><Folder size={13}/>{getProjectName(active.project, active.hostId)}</span>}<button className="context-refresh" onClick={() => void live.refresh(active.hostId).then(() => live.select(active.hostId, active.id)).then(() => setNotice('已从电脑同步实际会话')).catch(() => setNotice('刷新失败，请检查连接'))}>刷新真实记录</button></div>
            {active.messages.map((message) => <article key={message.id} className={'message message-' + message.role}>
              {message.role === 'user' ? <div className="user-bubble">{message.content}</div> :
                message.kind ? <details className={'activity-card native-activity' + (message.failed ? ' activity-failed' : '')} open={message.kind === 'reasoning' ? true : undefined}>
                  <summary>{message.complete ? <Check size={16}/> : <span className="activity-spinner"/>}{message.title ?? '工具调用'}{message.failed && <span className="activity-error">失败</span>}<ChevronDown size={15}/></summary>
                  {(message.content || message.detail) && <div className="activity-native-body">
                    {message.content && <p>{message.content}</p>}
                    {message.detail && <pre>{message.detail}</pre>}
                  </div>}
                </details> :
                <div className="assistant-response"><p>{message.content}</p>{message.activity && <details className="activity-card">
                  <summary><FileText size={16}/>{message.activity.title}<ChevronDown size={15}/></summary>
                  <div className="activity-lines">{message.activity.lines.map((line) => <div key={line}><Check size={13}/>{line}</div>)}</div>
                </details>}</div>}
              {!message.kind && <div className={'message-tools' + (message.role === 'user' ? ' message-tools-user' : '')}>
                {message.role === 'assistant' && <>
                <button title="复制消息" aria-label="复制消息" onClick={() => {
                  void copyToClipboard(message.content).then(() => setNotice('消息已复制')).catch(() => setNotice('浏览器不允许访问剪贴板'));
                }}><Copy size={16}/></button>
                {!isRunning && <button title="分支到新聊天（尚未接通）" aria-label="分支到新聊天" onClick={() => actionForCurrent('fork')}><GitBranch size={16}/></button>}</>}
                {message.timestampMs && <span>{new Date(message.timestampMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>}
            </article>)}
            {isRunning && <div className="thinking-row" aria-live="polite"><span className="activity-spinner"/>
              正在思考 · 已进行 {Math.max(0, Math.floor((Date.now() - (active.runningSinceMs ?? Date.now())) / 1000)) + (elapsedTick * 0)} 秒
              {active.syncPending ? ' · 等待连接同步' : ''}
            </div>}
          </div></div> : <div className="landing-heading"><h1>有什么可以帮忙的？</h1><p>在 {currentHost} 上开始新的 Codex 会话</p></div>}
          <div className="composer-zone"><div className="composer-shell">
            {active && <div className="composer-followup">
              <span>{live.status[currentHost] === 'online' ? '已连接 ' + currentHost : '电脑离线 · 请刷新核对'}</span>
              {live.errors[currentHost] && <span className="composer-sync-error">{live.errors[currentHost]}</span>}
              <select aria-label="后续消息处理方式" value={followUpMode} onChange={(event) =>
                setFollowUpMode(event.target.value === 'queue' ? 'queue' : 'steer')}>
                <option value="steer">引导</option>
                <option value="queue">排队</option>
              </select>
            </div>}
            {activeQueue.length > 0 && <div className="native-queue">
              <strong>服务器排队消息 · {activeQueue.length}</strong>
              {activeQueue.map((item) => <div key={item.id}><span>{item.text}</span>
                <button disabled={workingQueue === item.id} onClick={() => {
                  if (!active) return;
                  setWorkingQueue(item.id);
                  void live.deleteQueued(active.hostId, active.id, item.id).catch(() => setNotice('队列操作未确认，请刷新'))
                    .finally(() => setWorkingQueue(null));
                }}>移除</button>
              </div>)}
            </div>}
            {displayedGoal && <button className="goal-pill" onClick={() => { setGoalDraft(displayedGoal); setGoalEditor(true); }}><Target size={17}/>目标：{displayedGoal}
              {activeGoal?.status && <small> · {activeGoal.status}</small>}
            </button>}
            {goalEditor && <div className="goal-editor">
              <div className="goal-editor-title"><Target size={17}/>设置目标 <button aria-label="关闭" onClick={() => setGoalEditor(false)}><X size={17}/></button></div>
              <textarea aria-label="目标内容" value={goalDraft} onChange={(e) => setGoalDraft(e.target.value)} placeholder="描述你想完成的目标…"/>
              <div>
                <button disabled={goalWorking} onClick={clearCurrentGoal}>清除</button>
                {active && activeGoal && ['paused', 'blocked', 'usageLimited'].includes(activeGoal.status) &&
                  <button disabled={goalWorking} onClick={() => {
                    setGoalWorking(true);
                    void live.continueGoal(active.hostId, active.id).then(() => setGoalEditor(false))
                      .catch(() => setNotice('目标继续状态未确认')).finally(() => setGoalWorking(false));
                  }}>继续目标</button>}
                <button className="goal-save" disabled={goalWorking} onClick={saveGoal}>{goalWorking ? '保存中…' : '保存目标'}</button>
              </div>
            </div>}
            <div className="composer-box">
              {(plan || attachments.length > 0) && <div className="attachment-list">
                {plan && <button className="attachment-chip" onClick={() => setPlan(false)}><ListTodo size={14}/>计划模式 <X size={13}/></button>}
                {attachments.map((name) => <button key={name} className="attachment-chip" onClick={() => setAttachments((items) => items.filter((v) => v !== name))}><Paperclip size={14}/><span>{name}</span><X size={13}/></button>)}
              </div>}
              <textarea ref={composeRef} rows={2} aria-label="消息输入框" value={draft} placeholder="询问任何问题" onChange={(e) => setDrafts((items) => ({ ...items, [draftKey]: e.target.value }))} onKeyDown={handleEnter}/>
              <div className="composer-actions">
                <div className="composer-actions-left">
                  <input ref={fileRef} type="file" multiple hidden onChange={handleFiles}/>
                  <button className="composer-tool" title="添加内容" aria-label="添加内容" onClick={() => setPopup(popup === 'add' ? null : 'add')}><Plus size={23}/></button>
                  <button className="composer-tool" title="选择权限" aria-label="选择权限" onClick={() => setPopup(popup === 'permission' ? null : 'permission')}><Hand size={22}/></button>
                  <button className="model-selector" title="模型与思考强度" onClick={() => setPopup(popup === 'model' ? null : 'model')}>{selectedModel?.name ?? '选择模型'} · {effortLabels[effectiveEffort] ?? '默认'} <ChevronDown size={14}/></button>
                </div>
                <div className="composer-actions-right">
                  <button className="composer-host-selector" onClick={() => setPopup(popup === 'project' ? null : 'project')} title="选择电脑或项目"><Monitor size={14}/>{currentHost}<ChevronDown size={13}/></button>
                  {isRunning && <button className="stop-turn" disabled={!active?.activeTurnId || submitting} onClick={stopTurn} title="中断正在运行的轮次" aria-label="中断运行"><Square size={15}/></button>}
                  <button className="send-button" disabled={!draft.trim() || submitting || live.status[currentHost] !== 'online'} aria-label={submitting ? '发送中' : '发送消息'} title={live.status[currentHost] === 'online' ? '发送到 ' + currentHost : '电脑未连接'} onClick={send}>{submitting ? <span className="send-spinner"/> : <ArrowUp size={21}/>}</button>
                </div>
              </div>
              {popup === 'add' && <div className="popover composer-popover add-popover"><span className="popover-heading">添加到消息</span>
                <button onClick={() => { fileRef.current?.click(); setPopup(null); }}><Image size={18}/>照片 / 文件</button>
                <button onClick={() => { setPlan(!plan); setPopup(null); }}><ListTodo size={18}/>{plan ? '退出计划模式' : '计划模式'}</button>
                <button onClick={() => { setGoalDraft(displayedGoal); setGoalEditor(true); setPopup(null); }}><Target size={18}/>目标</button>
              </div>}
              {popup === 'permission' && <div className="popover composer-popover permission-popover"><span className="popover-heading">审批权限</span>
                {(['default','auto-review','read-only','full-access','custom'] as PermissionMode[]).map((mode) =>
                  <button key={mode} disabled={submitting || isRunning} onClick={() => selectPermission(mode)}>
                    <ShieldCheck size={17}/>{permissionLabels[mode]}{permission === mode && <Check className="check-icon" size={16}/>}
                  </button>)}
              </div>}
              {popup === 'model' && <div className="popover composer-popover model-popover"><span className="popover-heading">{currentHost} 的真实模型列表</span>
                {!availableModels.length && <span className="popover-heading">当前电脑暂未返回模型</span>}
                {availableModels.map((item) => <button key={item.id} onClick={() => {
                  setModelByHost((m) => ({ ...m, [currentHost]: item.id }));
                  setEffortByHost((m) => ({ ...m, [currentHost]: '' }));
                }}><span>{item.name}</span>{selectedModel?.id === item.id && <Check className="check-icon" size={16}/>}</button>)}
                <div className="popover-divider"/>
                {availableEfforts.map((item) => <button key={item} onClick={() => {
                  setEffortByHost((m) => ({ ...m, [currentHost]: item })); setPopup(null);
                }}>{effortLabels[item] ?? item}{effectiveEffort === item && <Check className="check-icon" size={16}/>}</button>)}
              </div>}
              {popup === 'project' && <div className="popover composer-popover target-popover"><span className="popover-heading">新聊天目标电脑 / 项目</span>
                {hosts.map((host) => <button key={host.id} onClick={() => { createNewChat(host.id); }}><Monitor size={17}/>{host.id}{!active && newHost === host.id && <Check className="check-icon" size={16}/>}</button>)}
                <div className="popover-divider"/>{projects.filter((p) => p.hostId === currentHost).map((p) =>
                  <button key={p.id} onClick={() => createNewChat(p.hostId, p.id)}><Folder size={16}/>{p.name}</button>)}
                <p className="popover-footnote">已有会话不可直接更换所属电脑。</p>
              </div>}
            </div>
            <div className="composer-footnote">私有 Tailscale 网页工作台 · 仅服务器确认后清空消息 · 断线请刷新核对</div>
          </div></div>
        </div>}
    </main>

    {searchOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="搜索所有聊天" className="search-dialog">
        <div className="search-input-row"><Search size={20}/><input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索所有电脑的项目和聊天…"/><button aria-label="关闭搜索" onClick={() => setSearchOpen(false)}><X size={20}/></button></div>
        <div className="search-results"><span className="popover-heading">{query.trim() ? '搜索结果 · ' + searchResults.length : '最近对话'}</span>
          {searchResults.length === 0 && <p className="search-empty">没有匹配的对话</p>}
          {searchResults.map((item) => <button className="search-result"
            key={conversationKey(item.hostId,item.id)} onClick={() => chooseConversation(item.hostId,item.id)}>
            <FileText size={19}/><span><strong>{item.title}</strong><small>{item.hostId} · {getProjectName(item.project, item.hostId) ?? '无项目'} · {dateLabel(item.updatedAt)}</small></span><ChevronRight size={17}/>
          </button>)}
        </div><div className="search-shortcut">Ctrl / ⌘ + K 搜索 <span>ESC 关闭</span></div>
      </div>
    </div>}

    {live.approval && <div className="approval-overlay"><div className="approval-dialog">
      <ShieldCheck size={24}/><h2>Codex 请求人工审批</h2>
      <p>电脑：{live.approval.hostId}</p><p>操作：{live.approval.method}</p>
      <pre className="approval-details">{live.approval.detail}</pre>
      <p>请核对操作详情再批准。若详情不足，请拒绝并在电脑端查看。</p>
      <div className="approval-actions">
        <button onClick={() => { try { live.replyApproval('decline'); } catch { setNotice('审批连接已断开，请刷新'); } }}>拒绝</button>
        <button disabled={live.approval.detail === '本次请求没有提供可核对的操作详情'} onClick={() => {
          if (!window.confirm('确认允许这台电脑执行上方操作？')) return;
          try { live.replyApproval('accept'); } catch { setNotice('审批连接已断开，请刷新'); }
        }}>批准本次操作</button>
      </div>
    </div></div>}

    {notice && <div className="toast" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15}/></button></div>}
    {popup && <button className="popup-dismiss" aria-label="关闭菜单" onClick={() => setPopup(null)}/>}
    <button className="mobile-menu" aria-label="展开侧边栏" onClick={() => setSidebarOpen(true)}><Menu size={21}/></button>
    <button className="mobile-new-chat" aria-label="新建聊天" onClick={() => createNewChat()}><SquarePen size={20}/></button>
  </div>;
}
