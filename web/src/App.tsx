import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowUp, Check, ChevronDown, ChevronRight, CircleHelp, Command, FileText,
  FolderClosed, Menu, Monitor, Moon, MoreHorizontal, PanelLeft, Paperclip,
  Plus, Search, Settings2, SquarePen, Sun, X,
} from 'lucide-react';
import {
  createDemoConversations, getDateGroup, getProjectName, hosts, projects,
} from './demo';
import type { Conversation, HostFilter, HostId, Message } from './demo';

type Popup = 'host' | 'project' | 'account' | null;
type Theme = 'light' | 'dark';

function isMobile() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function groupConversations(items: Conversation[]) {
  const now = Date.now();
  const groups = ['今天', '昨天', '更早'];
  return groups.map((title) => ({
    title,
    items: items.filter((item) => getDateGroup(item.updatedAt, now) === title),
  })).filter((group) => group.items.length > 0);
}

function StatusDot({ status }: { status: Conversation['status'] }) {
  if (status === 'idle') return null;
  return <span aria-label={status === 'running' ? '示例：执行中' : '未读'} className={'status-dot ' + status} />;
}

function App() {
  const [conversations, setConversations] = useState<Conversation[]>(createDemoConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hostFilter, setHostFilter] = useState<HostFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [composerHost, setComposerHost] = useState<HostId>('6v');
  const [composerProject, setComposerProject] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile());
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [popup, setPopup] = useState<Popup>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('codex-web-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const active = conversations.find((item) => item.id === activeId) ?? null;
  const currentHost = active?.hostId ?? composerHost;
  const currentProject = active?.project ?? composerProject;
  const draftKey = active ? 'thread:' + active.id : 'new:' + composerHost + ':' + (composerProject ?? 'none');
  const draft = drafts[draftKey] ?? '';

  const visible = useMemo(() => conversations.filter((item) =>
    (hostFilter === 'all' || item.hostId === hostFilter) &&
    (projectFilter === null || item.project === projectFilter)
  ).sort((a, b) => b.updatedAt - a.updatedAt), [conversations, hostFilter, projectFilter]);

  const searchResults = useMemo(() => {
    const term = searchText.trim().toLocaleLowerCase();
    if (!term) return [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    return conversations.filter((item) =>
      item.title.toLocaleLowerCase().includes(term) ||
      item.messages.some((message) => message.content.toLocaleLowerCase().includes(term)) ||
      item.hostId.toLocaleLowerCase().includes(term)
    ).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [conversations, searchText]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('codex-web-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#212121' : '#ffffff');
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        setPopup(null);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setPopup(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  function closeMobileSidebar() {
    if (isMobile()) setSidebarOpen(false);
  }

  function newChat() {
    setActiveId(null);
    setPopup(null);
    setFileNames([]);
    closeMobileSidebar();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function openConversation(id: string) {
    const item = conversations.find((conversation) => conversation.id === id);
    if (!item) return;
    setActiveId(id);
    setComposerHost(item.hostId);
    setComposerProject(item.project);
    setHostFilter('all');
    setProjectFilter(null);
    setPopup(null);
    setSearchOpen(false);
    setFileNames([]);
    setConversations((current) => current.map((conversation) =>
      conversation.id === id && conversation.status === 'unread'
        ? { ...conversation, status: 'idle' }
        : conversation
    ));
    closeMobileSidebar();
  }

  function chooseHost(host: HostFilter) {
    setHostFilter(host);
    setProjectFilter(null);
    if (host !== 'all') setComposerHost(host);
    setComposerProject(null);
    setActiveId(null);
    setFileNames([]);
    setPopup(null);
    closeMobileSidebar();
  }

  function chooseProject(id: string | null) {
    const project = projects.find((item) => item.id === id);
    setProjectFilter(id);
    setHostFilter('all');
    setActiveId(null);
    setComposerProject(id);
    if (project) setComposerHost(project.hostId);
    setFileNames([]);
    setPopup(null);
    closeMobileSidebar();
  }

  function send() {
    const text = draft.trim();
    if (!text) {
      if (fileNames.length) setToast('附件仅用于视觉预览，暂时不能上传或发送');
      return;
    }
    const message: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    if (active) {
      setConversations((current) => current.map((item) => item.id === active.id ? {
        ...item, messages: [...item.messages, message], updatedAt: Date.now(), status: 'idle',
      } : item));
    } else {
      const id = crypto.randomUUID();
      const item: Conversation = {
        id, hostId: composerHost, project: composerProject,
        title: text.length > 28 ? text.slice(0, 28) + '…' : text,
        status: 'idle', updatedAt: Date.now(), messages: [message],
      };
      setConversations((current) => [item, ...current]);
      setActiveId(id);
      setHostFilter('all');
      setProjectFilter(null);
    }
    setDrafts((current) => ({ ...current, [draftKey]: '' }));
    setFileNames([]);
    setPopup(null);
    setToast('消息仅保存在当前页面中，尚未连接 Codex App Server');
  }

  function onComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const names = Array.from(event.target.files ?? []).map((file) => file.name).slice(0, 4);
    setFileNames(names);
    if (names.length) setToast('附件只显示文件名，不读取或上传文件');
    event.target.value = '';
  }

  return (
    <div className={'app-shell' + (sidebarOpen ? ' sidebar-is-open' : ' sidebar-is-closed')}>
      {sidebarOpen && <button className="mobile-scrim" aria-label="关闭侧边栏" onClick={() => setSidebarOpen(false)} />}

      <aside className="sidebar-rail" aria-label="导航侧边栏">
        <div className="sidebar-inner">
          <div className="sidebar-head">
            <button className="icon-button" title="收起侧边栏" aria-label="收起侧边栏" onClick={() => setSidebarOpen(false)}><PanelLeft size={20} strokeWidth={1.8} /></button>
            <button className="icon-button" title="新建聊天" aria-label="新建聊天" onClick={newChat}><SquarePen size={20} strokeWidth={1.8} /></button>
          </div>

          <div className="primary-nav">
            <button className="nav-row" onClick={() => { setSearchText(''); setSearchOpen(true); }}><Search size={18} strokeWidth={1.8} /><span>搜索聊天</span><span className="key-cap">Ctrl K</span></button>
            <button className="nav-row" onClick={newChat}><SquarePen size={18} strokeWidth={1.8} /><span>新建聊天</span></button>
            <button className="nav-row" onClick={() => setProjectsOpen((value) => !value)} aria-expanded={projectsOpen}><FolderClosed size={18} strokeWidth={1.8} /><span>项目</span>{projectsOpen ? <ChevronDown className="nav-trailing" size={15} /> : <ChevronRight className="nav-trailing" size={15} />}</button>
          </div>

          <div className="sidebar-scroll">
            {projectsOpen && (
              <section className="sidebar-section project-section" aria-label="示例项目">
                {projects.map((project) => <button key={project.id} className={'section-row project-row' + (projectFilter === project.id ? ' is-selected' : '')} onClick={() => chooseProject(project.id)}><span className="project-monogram">{project.name.slice(0, 1)}</span><span className="row-title">{project.name}</span><span className="row-hint">{project.hostId}</span></button>)}
              </section>
            )}

            <section className="sidebar-section" aria-label="电脑筛选">
              <h2 className="section-heading">电脑 <span>示例</span></h2>
              <button className={'section-row host-row' + (hostFilter === 'all' && !projectFilter ? ' is-selected' : '')} onClick={() => chooseHost('all')}><span className="host-icon"><Monitor size={16} /></span><span className="row-title">全部电脑</span></button>
              {hosts.map((host) => <button key={host.id} className={'section-row host-row' + (hostFilter === host.id ? ' is-selected' : '')} onClick={() => chooseHost(host.id)}><span className="host-icon"><Monitor size={16} /></span><span className="row-title">{host.displayName}</span><span className="host-demo-dot" title="未连接真实设备" /></button>)}
            </section>

            <section className="sidebar-section recents" aria-label="最近对话">
              <h2 className="section-heading">最近对话</h2>
              {visible.length === 0 && <p className="empty-recents">这个筛选下没有演示会话</p>}
              {groupConversations(visible).map((group) => <div key={group.title} className="recent-group"><h3>{group.title}</h3>{group.items.map((item) => <button key={item.id} className={'conversation-row' + (activeId === item.id ? ' is-selected' : '')} onClick={() => openConversation(item.id)} title={item.title + ' · ' + item.hostId}><span className="conversation-name">{item.title}</span><span className="conversation-end"><span className="conversation-host">{item.hostId}</span><StatusDot status={item.status} /></span></button>)}</div>)}
            </section>
          </div>

          <div className="sidebar-footer">
            <button className="account-row" onClick={() => setPopup(popup === 'account' ? null : 'account')} aria-expanded={popup === 'account'}><span className="avatar">C</span><span className="account-text"><strong>Codex 工作台</strong><small>本地视觉原型</small></span><MoreHorizontal size={18} /></button>
            {popup === 'account' && <div className="account-popover popover"><button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setPopup(null); }}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}切换为{theme === 'dark' ? '浅色' : '深色'}模式</button><button onClick={() => { setToast('当前为本地视觉原型，尚未接入真实设备'); setPopup(null); }}><CircleHelp size={16} />关于原型</button></div>}
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && <button className="icon-button sidebar-reopen" aria-label="展开侧边栏" title="展开侧边栏" onClick={() => setSidebarOpen(true)}><PanelLeft size={21} strokeWidth={1.8} /></button>}
            <button className="model-name" onClick={() => setPopup(popup === 'host' ? null : 'host')} aria-expanded={popup === 'host'}><strong>Codex</strong><ChevronDown size={16} strokeWidth={1.8} /></button>
          </div>
          <div className="topbar-right"><span className="preview-tag">预览模式</span><button className="host-switcher" onClick={() => setPopup(popup === 'host' ? null : 'host')} aria-expanded={popup === 'host'}><Monitor size={15} /><span>{currentHost}</span><ChevronDown size={14} /></button><button className="top-avatar" title="外观设置" aria-label="外观设置" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>C</button></div>
          {popup === 'host' && <div className="host-popover popover"><p className="popover-heading">新聊天使用哪台电脑</p>{hosts.map((host) => <button key={host.id} onClick={() => { setComposerHost(host.id); setComposerProject(null); setActiveId(null); setHostFilter(host.id); setProjectFilter(null); setPopup(null); }}><Monitor size={17} /><span className="popover-label"><strong>{host.displayName}</strong><small>{host.description} · 未连接</small></span>{currentHost === host.id && <Check size={17} className="check-icon" />}</button>)}<p className="popover-footnote">切换电脑会开始新聊天，不迁移当前会话。</p></div>}
        </header>

        <div className={'chat-region' + (active ? ' has-conversation' : ' is-landing')}>
          {active ? <div className="message-scroller" key={active.id}><div className="messages-wrap"><div className="chat-context"><span><Monitor size={13} /> {active.hostId}</span>{active.project && <span><FolderClosed size={13} /> {getProjectName(active.project)}</span>}<span className="demo-context">演示对话</span></div>{active.messages.map((message) => <article key={message.id} className={'message message-' + message.role}>{message.role === 'user' ? <div className="user-bubble">{message.content}</div> : <div className="assistant-response"><div className="assistant-label"><span className="assistant-mark">✳</span> Codex</div><p>{message.content}</p>{message.activity && <details className="activity-card"><summary><FileText size={16} />{message.activity.title}<ChevronDown size={15} /></summary><div className="activity-lines">{message.activity.lines.map((line) => <div key={line}><Check size={13} />{line}</div>)}</div></details>}</div>}</article>)}</div></div> : <div className="landing-heading"><h1>有什么可以帮忙的？</h1><p>选择一台电脑，在这里开始你的工作</p></div>}

          <div className="composer-zone">
            <div className="composer-shell">
              <div className="composer-box">
                {fileNames.length > 0 && <div className="attachment-list">{fileNames.map((name) => <span key={name}><Paperclip size={14} /><span>{name}</span><button aria-label={'移除 ' + name} onClick={() => setFileNames((items) => items.filter((item) => item !== name))}><X size={13} /></button></span>)}</div>}
                <textarea ref={inputRef} rows={1} aria-label="输入消息" value={draft} placeholder="询问任何问题" onChange={(event) => setDrafts((current) => ({ ...current, [draftKey]: event.target.value }))} onKeyDown={onComposerKeyDown} />
                <div className="composer-actions">
                  <div className="composer-actions-left"><input ref={fileRef} type="file" multiple hidden onChange={onFilesSelected} /><button className="round-action attachment-action" title="添加附件（演示）" aria-label="添加附件（演示）" onClick={() => fileRef.current?.click()}><Plus size={21} strokeWidth={1.7} /></button><div className="project-picker-wrap"><button className="project-picker" disabled={Boolean(active)} aria-expanded={popup === 'project'} onClick={() => setPopup(popup === 'project' ? null : 'project')}><FolderClosed size={15} /><span>{getProjectName(currentProject) ?? '选择项目'}</span>{!active && <ChevronDown size={14} />}</button>{popup === 'project' && !active && <div className="project-popover popover"><p className="popover-heading">项目</p><button onClick={() => { setComposerProject(null); setPopup(null); }}>不使用项目{!composerProject && <Check size={16} className="check-icon" />}</button>{projects.filter((project) => project.hostId === composerHost).map((project) => <button key={project.id} onClick={() => { setComposerProject(project.id); setPopup(null); }}><FolderClosed size={16} />{project.name}{composerProject === project.id && <Check size={16} className="check-icon" />}</button>)}</div>}</div></div>
                  <div className="composer-actions-right"><span className="composer-host"><Monitor size={14} />{currentHost}</span><button className="send-button" aria-label="发送（本地演示）" title="发送（本地演示）" disabled={!draft.trim()} onClick={send}><ArrowUp size={19} strokeWidth={2.3} /></button></div>
                </div>
              </div>
              <p className="composer-note">网页视觉原型 · 数据和消息仅在当前页面中演示 · 未连接 App Server</p>
            </div>
          </div>
        </div>
      </main>

      {searchOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }}><div role="dialog" aria-modal="true" aria-label="搜索聊天" className="search-dialog"><div className="search-input-row"><Search size={20} /><input ref={searchRef} value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索所有电脑的聊天…" aria-label="搜索关键词" /><button className="icon-button" aria-label="关闭搜索" onClick={() => setSearchOpen(false)}><X size={19} /></button></div><div className="search-results"><p className="search-caption">{searchText.trim() ? '搜索结果 · ' + searchResults.length : '最近对话'}</p>{searchResults.length === 0 && <div className="search-empty">没有找到相关对话</div>}{searchResults.map((item) => <button className="search-result" key={item.id} onClick={() => openConversation(item.id)}><div className="result-icon"><FileText size={17} /></div><div><strong>{item.title}</strong><small>{item.hostId} · {getProjectName(item.project) ?? '无项目'}</small></div><ChevronRight size={16} className="result-arrow" /></button>)}</div><div className="search-shortcut"><Command size={13} /> 输入关键词搜索示例会话 <span>ESC 关闭</span></div></div></div>}
      {toast && <div role="status" className="toast"><Settings2 size={16} />{toast}<button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
      {popup && <button className="popup-dismiss" aria-label="关闭菜单" onClick={() => setPopup(null)} />}
      <button className="mobile-new-chat" title="新建聊天" aria-label="新建聊天" onClick={newChat}><SquarePen size={20} /></button>
      <button className="mobile-menu" title="打开导航" aria-label="打开导航" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
    </div>
  );
}

export default App;
