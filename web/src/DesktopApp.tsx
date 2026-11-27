import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent,
  CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent } from 'react';
import {
  ArrowDown, ArrowUp, Archive, Check, ChevronDown, ChevronRight, Clock3, Copy, Ellipsis,
  FileText, Folder, GitBranch, Hand, Image, ListTodo, Menu, Monitor, Plug, RefreshCw, Square,
  Moon, PanelLeftClose, PanelLeftOpen, Pin, Share2, Link2, Eye, EyeOff, FolderInput, FolderOpen,
  Plus, Puzzle, Search, Settings, ShieldCheck, ShieldLock, SquarePen, Sun, Target, Trash2, TriangleAlert, X, Pencil, Minimize2, PanelRightOpen,
  type LucideIcon,
} from 'lucide-react';
import { validHostId } from './types';
import type { Conversation, HostId } from './types';
import type { NativeProject } from './nativeProtocol';
import { fetchSidebarPins, setSidebarPin, parseSidebarPins, type SidebarPin,
  type SidebarPinsSnapshot } from './sidebarPins';
import { fetchThreadCompletions, parseThreadCompletions, setThreadCompletion,
  writeCachedThreadCompletions,
  type CompletedThread, type ThreadCompletionsSnapshot } from './threadCompletions';
import {
  PROJECT_THREAD_PREVIEW_LIMIT, clearProjectThreadLimit, nextProjectThreadLimit, visibleProjectThreads,
} from './projectThreadVisibility';
import {
  clampSidebarWidth, defaultSidebarPreferences, loadSidebarPreferences, saveSidebarPreferences,
} from './sidebarPreferences';
import { sidebarPullDistance, SIDEBAR_PULL_THRESHOLD } from './sidebarPullRefresh';
import { useLiveCodex } from './useLiveCodex';
import { useThreadSearch } from './useThreadSearch';
import { MessageImage } from './MessageImage';
import { ImageZoomSurface } from './ImageZoomSurface';
import { ToolImage } from './ToolImage';
import { findToolLogo, parseToolLogos, toolDisplayName, type ToolLogo } from '../../shared/toolVisuals';
import { MessageMarkdown } from './MessageMarkdown';
import { ProjectCreateDialog } from './ProjectCreateDialog';
import { AutomationView } from './AutomationView';
import { useBrowserNotifications } from './useBrowserNotifications';
import { SettingsView } from './SettingsView';
import { PublicationPreview, type PublicationTarget } from './PublicationPreview';
import { ImageViewerSaveActions } from './ImageViewerSaveActions';
import {
  viewerSourceFromBlob, viewerSourceFromBlobUrl, type ImageViewerSource,
} from './imageViewer';
import { useImageLongPress, type MenuPoint } from './useImageLongPress';
import { documentFileAllowed } from './documentUpload';
import { useFollowLatest } from './useFollowLatest';
import { ThinkingIndicator } from './ThinkingIndicator';
import type { PermissionMode, FollowUpMode } from './useLiveCodex';
import { copyToClipboard, localMessageId } from './browserHelpers';
import { desktopBridge } from './desktopBridge';
import { DesktopTitlebar } from './DesktopTitlebar';
import { defaultPathHosts, fetchPathHosts, pathForViewer, savePathHosts, type PathHosts } from './pathHosts';
import { detectBrowserMachine } from './browserMachine';
import {
  addOptimisticSubmission, positionOptimisticSubmissions, reconcileOptimisticAfterRead, visibleOptimisticSubmissions,
} from './optimisticSubmissions';
import type { OptimisticSubmission } from './optimisticSubmissions';
import { cachedMentions, refreshCachedMentions, filteredMentions, mentionQuery, selectedNativeMentions,
  type Mention } from '../../shared/mentions';
import { quotaPercent, quotaResetLabel, type RateQuota } from '../../shared/rateLimits';
import { contextUsagePercent, formatContextTokens } from '../../shared/contextUsage';
import { compactionBusy } from './compaction';
import { groupSubAgentActivity, ReasoningActivity, SubAgentActivityFeed } from './ThreadActivity';
import { SideChatPanel } from './SideChatPanel';
import { contextTargetFromAttributes, gestureMoved, readUnreadThreads, threadFromLink, threadLink,
  type ContextTarget } from './contextActions';

type Popup = 'host' | 'project' | 'account' | 'add' | 'permission' | 'model' | 'context' | 'options' | 'recent' | null;
type Theme = 'dark' | 'light';
type ViewMode = 'chat' | 'tasks';
type RenameLocation = 'pinned' | 'project' | 'recent';
type InlineRename = {
  hostId: HostId; threadId: string; location: RenameLocation;
  original: string; draft: string; saving: boolean;
};
type IconProps = { size?: number; className?: string };
type PastedImage = { id: string; file: File; url: string };
type PastedDocument = { id: string; file: File };
type SidebarConversation = Pick<Conversation, 'id' | 'hostId' | 'title' | 'status' | 'project' | 'archived' | 'updatedAt'>;
type ContextMenu = ContextTarget & { x: number; y: number; page: 'main' | 'projects' };
type RenameTarget = { kind: 'thread' | 'project'; hostId: HostId; id: string; original: string };
type ChatFind = { key: string; query: string; current: number };

function ToolBrandIcon({ logo }: { logo?: ToolLogo }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [logo?.url]);
  return logo && !broken
    ? <img className="tool-brand-logo" src={logo.url} alt="" loading="lazy"
        onError={() => setBroken(true)}/>
    : <Plug size={15} aria-hidden="true"/>;
}

function MentionIcon({ item }: { item: Mention }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [item.iconUrl]);
  return <span className="mention-icon" aria-hidden="true">
    {item.iconUrl && !failed ? <img src={item.iconUrl} alt="" loading="lazy"
      onError={() => setFailed(true)} /> : item.kind === 'skill'
      ? <Puzzle size={18}/> : <Plug size={18}/>}
  </span>;
}

// Exact board-and-pen silhouette from the current native ReferenceIcons design.
function ComposeIcon({ size = 21, className }: IconProps) {
  return <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.8 4.5H6a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
    <path d="m9.5 14.5 1.5-4.2L19 2.5a2 2 0 0 1 2.8 2.8l-8 8-4.3 1.2z" />
  </svg>;
}

const permissionIcons: Record<PermissionMode, LucideIcon> = {
  default: Hand,
  'auto-review': ShieldCheck,
  'read-only': ShieldLock,
  'full-access': TriangleAlert,
  custom: Settings,
};

function WebQuotaRing({ kind, label, quota, onClick }: {
  kind: 'fiveHour' | 'weekly'; label: string; quota: RateQuota | null; onClick: () => void;
}) {
  const percent = quotaPercent(quota, kind);
  const circumference = Math.PI * 36;
  return <button className="quota-ring-button" onClick={onClick}
    aria-label={label + (percent === null ? '额度未知' : '额度剩余' + percent + '%')}
    title={label + (percent === null ? ' —' : ' 剩余 ' + percent + '%')}>
    <span className="quota-ring-graphic">
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
        <circle cx="22" cy="22" r="18" stroke="var(--dim)" strokeWidth="4" fill="none" opacity=".5"/>
        {percent !== null && <circle cx="22" cy="22" r="18" stroke="#4b9cff"
          strokeWidth="4" strokeLinecap="round" fill="none"
          strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)}
          transform="rotate(-90 22 22)"/>}
      </svg>
      <span>{percent === null ? '—' : percent}</span>
    </span>
    <span className="quota-ring-caption">{label}</span>
  </button>;
}

function mobileLayout() { return window.matchMedia('(max-width: 800px)').matches; }
function savedSharedPins(): SidebarPinsSnapshot {
  try { return parseSidebarPins(JSON.parse(localStorage.getItem('codex-web-shared-pins') ?? 'null')); }
  catch { return { revision: 0, items: [] }; }
}
function savedThreadCompletions(): ThreadCompletionsSnapshot {
  try {
    return parseThreadCompletions(
      JSON.parse(localStorage.getItem('codex-web-thread-completions') ?? 'null'));
  } catch {
    return { revision: 0, items: [] };
  }
}
function dateLabel(ts: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return ts >= today.getTime() ? '今天' : ts >= today.getTime() - 86400000 ? '昨天' : '更早';
}

function quotaGuardStatusLabel(status: string | undefined): string {
  switch (status) {
    case 'off': return '保护未启用';
    case 'ready': return '保护就绪';
    case 'guarded': return '已阻止新工作';
    case 'interrupting': return '正在中断已运行回合';
    case 'confirmed': return '已中断，等待额度恢复';
    case 'failed': return '中断尚未确认';
    case 'degraded': return '额度监控异常';
    case 'pending': return '等待两台电脑同步';
    default: return '正在读取共享状态';
  }
}
function StatusMark({ status }: { status: Conversation['status'] }) {
  if (status === 'idle') return null;
  return <span className={'status-dot ' + status} title={status === 'running' ? '正在执行' : '未读消息'} />;
}

export default function DesktopApp() {
  const live = useLiveCodex();
  useEffect(() => {
    (window as Window & { ReactNativeWebView?: {
      postMessage: (value: string) => void
    } }).ReactNativeWebView?.postMessage('codexmobileui:web-ready');
  }, []);
  const [initialSidebar] = useState(() => {
    try { return loadSidebarPreferences(window.localStorage); }
    catch { return defaultSidebarPreferences(); }
  });
  const { conversations, projects, hosts } = live;
  const getProjectName = (id: string | null, hostId?: HostId) =>
    projects.find((p) => p.id === id && (!hostId || p.hostId === hostId))?.name ?? null;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidePanelFor, setSidePanelFor] = useState<string | null>(null);
  const [sideInitialSelection, setSideInitialSelection] = useState<string | undefined>();
  const [sideDrafts, setSideDrafts] = useState<Record<string, string>>({});
  const conversationKey = (hostId: HostId, id: string) => hostId + ':' + id;
  const [newHost, setNewHost] = useState<HostId>('6v');
  const newHostRef = useRef<HostId>('6v');
  newHostRef.current = newHost;
  const [newProject, setNewProject] = useState<string | null>(null);
  const [hostFilter, setHostFilter] = useState<'all' | HostId>('all');
  const [hostCollapsed, setHostCollapsed] = useState<HostId[]>(initialSidebar.collapsedHosts);
  const [openedProjects, setOpenedProjects] = useState<string[]>(initialSidebar.openedProjects);
  const [projectThreadLimits, setProjectThreadLimits] = useState<Record<string, number>>({});
  const [showAllRecent, setShowAllRecent] = useState(initialSidebar.showAllRecent);
  const [showArchived, setShowArchived] = useState(false);
  const [recentLimit, setRecentLimit] = useState(10);
  const [sharedPins, setSharedPins] = useState<SidebarPinsSnapshot>(savedSharedPins);
  const pinsRevision = useRef(sharedPins.revision);
  const pinnedIds = useMemo(() => sharedPins.items.filter((pin) => pin.type === 'thread')
    .map((pin) => pin.hostId + ':' + pin.id), [sharedPins.items]);
  const pinnedProjectIds = useMemo(() => sharedPins.items.filter((pin) => pin.type === 'project')
    .map((pin) => pin.hostId + ':' + pin.id), [sharedPins.items]);
  const [threadCompletions, setThreadCompletions] =
    useState<ThreadCompletionsSnapshot>(savedThreadCompletions);
  const completionsRevision = useRef(threadCompletions.revision);
  const completedThreadIds = useMemo(() => threadCompletions.items
    .map((item) => item.hostId + ':' + item.threadId), [threadCompletions.items]);
  const [collapsedSections, setCollapsedSections] = useState<string[]>(initialSidebar.collapsedSections);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftRevisions = useRef<Record<string, number>>({});
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebar.sidebarOpen ?? !mobileLayout());
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(initialSidebar.sidebarWidth, window.innerWidth));
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarResize = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [sidebarPull, setSidebarPull] = useState(0);
  const [sidebarRefreshing, setSidebarRefreshing] = useState(false);
  const sidebarRefreshBusy = useRef(false);
  const sidebarTouchStart = useRef<{ x: number; y: number } | null>(null);
  const sidebarPullLatest = useRef(0);
  const [popup, setPopup] = useState<Popup>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = addMenuRef.current;
    if (popup !== 'add' || !menu) return;
    const viewport = window.visualViewport;
    const fitMenu = () => {
      const available = menu.getBoundingClientRect().bottom - (viewport?.offsetTop ?? 0) - 12;
      menu.style.setProperty('--add-menu-height', Math.max(0, available) + 'px');
    };
    const composer = menu.parentElement;
    const observer = new ResizeObserver(fitMenu);
    if (composer) observer.observe(composer);
    window.addEventListener('resize', fitMenu);
    viewport?.addEventListener('resize', fitMenu);
    viewport?.addEventListener('scroll', fitMenu);
    fitMenu();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fitMenu);
      viewport?.removeEventListener('resize', fitMenu);
      viewport?.removeEventListener('scroll', fitMenu);
    };
  }, [popup]);
  const [quotaDetail, setQuotaDetail] = useState<'fiveHour' | 'weekly' | null>(null);
  const [quotaGuardWorking, setQuotaGuardWorking] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProject, setSettingsProject] = useState<{ hostId: HostId; id: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [chatFind, setChatFind] = useState<ChatFind | null>(null);
  const [unreadThreads, setUnreadThreads] = useState<Record<string, true>>(() => {
    try { return readUnreadThreads(localStorage.getItem('codex-web-unread-threads')); }
    catch { return {}; }
  });
  const pendingDeepLink = useRef(threadFromLink(window.location.href));
  const longPress = useRef<{ pointerId: number; x: number; y: number; target: ContextTarget;
    timer: number; fired: boolean } | null>(null);
  const suppressNextClick = useRef<{ hostId: HostId; id: string; until: number } | null>(null);
  const [pathHosts, setPathHosts] = useState<PathHosts>(defaultPathHosts);
  const [manualViewerHost, setManualViewerHost] = useState<HostId | null>(() => {
    const stored = window.localStorage.getItem('codexmobileui:viewerHost');
    return validHostId(stored) ? stored : null;
  });
  const [autoViewerHost, setAutoViewerHost] = useState<HostId | null>(null);
  const viewerHost = autoViewerHost ?? manualViewerHost;
  const syncDesktopPathHosts = (hosts: PathHosts) => {
    const native = desktopBridge();
    if (native?.syncPathHosts) void native.syncPathHosts(hosts).catch(() => undefined);
  };
  useEffect(() => {
    void fetchPathHosts().then((hosts) => {
      setPathHosts(hosts); syncDesktopPathHosts(hosts);
    }).catch(() => undefined);
    const native = desktopBridge();
    if (native?.localHost) {
      void native.localHost().then((host) => {
        if (host === '6v' || host === 'noha') setAutoViewerHost(host);
      }).catch(() => undefined);
    } else {
      void detectBrowserMachine().then(setAutoViewerHost);
    }
  }, []);
  const changeViewerHost = (host: HostId | null) => {
    if (autoViewerHost || desktopBridge()) return;
    setManualViewerHost(host);
    if (host) window.localStorage.setItem('codexmobileui:viewerHost', host);
    else window.localStorage.removeItem('codexmobileui:viewerHost');
  };
  const [publicationTarget, setPublicationTarget] = useState<PublicationTarget | null>(null);
  const [forkingThread, setForkingThread] = useState<string | null>(null);
  const forkBusy = useRef(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('chat');
  const [reminderTarget, setReminderTarget] = useState<{
    hostId: HostId; taskId: string; runId: string; navigation: number;
  } | null>(null);
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);
  const pastedImagesRef = useRef<PastedImage[]>([]);
  pastedImagesRef.current = pastedImages;
  const [pastedDocuments, setPastedDocuments] = useState<PastedDocument[]>([]);
  const pastedDocumentsRef = useRef<PastedDocument[]>([]);
  pastedDocumentsRef.current = pastedDocuments;
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPhase, setUploadPhase] = useState<'uploading' | 'sending' | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const [imageViewer, setImageViewer] = useState<ImageViewerSource | null>(null);
  const [imageSaveMenu, setImageSaveMenu] = useState<MenuPoint | null>(null);
  const imageLongPress = useImageLongPress(Boolean(imageViewer), setImageSaveMenu);
  useEffect(() => { setImageSaveMenu(null); }, [imageViewer]);
  const [toolLogos, setToolLogos] = useState<Record<HostId, ToolLogo[]>>({ '6v': [], noha: [] });
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PermissionMode | null>(null);
  const [nextPermissions, setNextPermissions] = useState<Partial<Record<string, PermissionMode>>>({});
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [editingThread, setEditingThread] = useState(false);
  const [inlineRename, setInlineRename] = useState<InlineRename | null>(null);
  const inlineRenameBusy = useRef(false);
  const inlineRenameInputRef = useRef<HTMLInputElement>(null);
  const [optimisticSubmissions, setOptimisticSubmissions] = useState<OptimisticSubmission[]>([]);
  const sendBusy = useRef(false);
  const [plan, setPlan] = useState(false);
  const [goal, setGoal] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const [goalEditor, setGoalEditor] = useState(false);
  const [goalWorking, setGoalWorking] = useState(false);
  const [modelWorkingFor, setModelWorkingFor] = useState<string | null>(null);
  const [modelByHost, setModelByHost] = useState<Record<HostId, string>>({ '6v': '', noha: '' });
  const [effortByHost, setEffortByHost] = useState<Record<HostId, string>>({ '6v': '', noha: '' });
  const [permission, setPermission] = useState<PermissionMode>('custom');
  const [followUpMode, setFollowUpMode] = useState<FollowUpMode>(() =>
    localStorage.getItem('codex-web-follow-up') === 'queue' ? 'queue' : 'steer');
  const [workingQueue, setWorkingQueue] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem('codex-web-visual-theme') === 'light' ? 'light' : 'dark');
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionByScope, setMentionByScope] = useState<Record<string, Mention[]>>({});
  const [mentionRefreshing, setMentionRefreshing] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionCaret, setMentionCaret] = useState(0);
  const [chosenMentions, setChosenMentions] = useState<Record<string, Mention[]>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef<HTMLInputElement>(null);
  const active = conversations.find((item) => conversationKey(item.hostId, item.id) === activeId) ?? null;
  const subAgentGroups = useMemo(() => groupSubAgentActivity(active?.messages ?? []), [active?.messages]);
  const subAgentRows = useMemo(() => new Map(subAgentGroups.map((group) => [group.childId, group])), [subAgentGroups]);
  const browserNotifications = useBrowserNotifications(view === 'chat' && active
    ? { hostId: active.hostId, threadId: active.id } : null);
  const currentHost = active?.hostId ?? newHost;
  const currentQuota = live.rateQuota[currentHost] ?? null;
  const quotaGuardState = live.quotaGuard;
  useEffect(() => {
    if (!quotaDetail) return;
    void live.refreshQuotaGuard().catch(() => undefined);
    void live.refreshRateQuota(currentHost).catch(() => undefined);
  }, [quotaDetail, currentHost, live.refreshQuotaGuard, live.refreshRateQuota]);
  const quotaGuardEditable = !!quotaGuardState && !quotaGuardWorking && live.status['6v'] === 'online';
  const quotaGuardHasAdditionalPeers = hosts.some(({ id }) => id !== '6v' && id !== 'noha');
  const quotaThresholdEditable = quotaGuardEditable &&
    (!quotaGuardState?.enabled || !quotaGuardHasAdditionalPeers);
  async function saveQuotaGuardSettings(enabled: boolean, thresholdPercent: number) {
    if (!quotaGuardEditable || (enabled && quotaGuardHasAdditionalPeers)) return;
    setQuotaGuardWorking(true);
    try {
      await live.setQuotaGuardSettings(enabled, thresholdPercent);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'QUOTA_GUARD_CONFLICT') {
        await live.refreshQuotaGuard().catch(() => undefined);
        setNotice('共享保护设置已由另一客户端更新，请核对后重试');
      } else {
        setNotice('无法保存共享额度保护设置，请检查 6v 连接');
      }
    } finally {
      setQuotaGuardWorking(false);
    }
  }
  useEffect(() => {
    // The Android shell mirrors only a bounded rate-limit snapshot to its home widget.
    // No chat text, account credentials, or host network addresses cross this bridge.
    const bridge = (window as Window & {
      ReactNativeWebView?: { postMessage: (value: string) => void };
    }).ReactNativeWebView;
    if (!bridge) return;
    bridge.postMessage('codexmobileui:quota:' + JSON.stringify({
      host: currentHost,
      fiveHour: quotaPercent(currentQuota, 'fiveHour'),
      weekly: quotaPercent(currentQuota, 'weekly'),
      updatedAt: currentQuota?.updatedAt ?? 0,
    }));
  }, [currentHost, currentQuota]);
  const currentProject = active?.project ?? newProject;
  const landingProjectName = !active ? getProjectName(newProject, currentHost) : undefined;
  // The unsent new-thread draft belongs to the composer, not a transient chat ID.
  const draftKey = active ? 'thread:' + conversationKey(active.hostId, active.id) : 'new:draft';
  const navigationKey = useRef(draftKey);
  navigationKey.current = draftKey;
  const draft = drafts[draftKey] ?? '';
  const visibleLocalSubmissions = useMemo(() => visibleOptimisticSubmissions(
    optimisticSubmissions, draftKey, active?.messages ?? [],
  ), [optimisticSubmissions, draftKey, active?.messages]);
  const optimisticPositions = useMemo(() => positionOptimisticSubmissions(
    visibleLocalSubmissions, active?.messages ?? [],
  ), [visibleLocalSubmissions, active?.messages]);
  const mentionScope = currentHost + ':' + (currentProject ?? '');
  const mentionSelectionKey = mentionScope + ':' + draftKey;
  const mentionItems = mentionByScope[mentionScope] ?? cachedMentions(mentionScope);
  const activeMention = mentionOpen ? mentionQuery(draft, mentionCaret) : null;
  const mentionOptions = activeMention
    ? filteredMentions(mentionItems, activeMention.query) : [];
  const mentionGroups = (['plugin', 'app', 'skill'] as const).map((kind) => ({
    kind, label: kind === 'plugin' ? '插件' : kind === 'app' ? '应用' : '独立 Skills',
    options: mentionOptions.map((item, index) => ({ item, index }))
      .filter(({ item }) => item.kind === kind),
  })).filter(({ options }) => options.length > 0);
  useEffect(() => { setMentionOpen(false); setMentionIndex(0); }, [mentionScope, draftKey]);
  useEffect(() => {
    if (!mentionOpen) return;
    let alive = true;
    const cwd = projects.find((p) => p.hostId === currentHost && p.id === currentProject)?.roots[0];
    setMentionByScope((old) => ({ ...old, [mentionScope]: cachedMentions(mentionScope) }));
    setMentionRefreshing(true);
    void refreshCachedMentions(mentionScope,
      (method, params) => live.request(currentHost, method, params), cwd, active?.id ?? null,
      (items) => {
        if (alive) setMentionByScope((old) => ({ ...old, [mentionScope]: items }));
      }).finally(() => { if (alive) setMentionRefreshing(false); });
    return () => { alive = false; };
  }, [mentionOpen, mentionScope, draftKey]);
  useEffect(() => {
    if (!mentionOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || composeRef.current?.contains(target) ||
          (target instanceof Element && target.closest('.mention-popover'))) return;
      setMentionOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [mentionOpen]);
  function updateMentionDraft(value: string, caret: number) {
    draftRevisions.current[draftKey] = (draftRevisions.current[draftKey] ?? 0) + 1;
    setDrafts((items) => ({ ...items, [draftKey]: value }));
    setMentionCaret(caret);
    setMentionOpen(!!mentionQuery(value, caret));
    setMentionIndex(0);
  }
  function chooseMention(item: Mention) {
    const found = mentionQuery(draft, mentionCaret);
    if (!found) return;
    const before = draft.slice(0, found.start), after = draft.slice(mentionCaret);
    const token = '@' + item.name;
    const caret = before.length + token.length + 1;
    updateMentionDraft(before + token + ' ' + after, caret);
    setChosenMentions((old) => ({ ...old, [mentionSelectionKey]: [...(old[mentionSelectionKey] ?? [])
      .filter((entry) => entry.name !== item.name), item] }));
    setMentionOpen(false);
    composeRef.current?.focus();
    requestAnimationFrame(() => composeRef.current?.setSelectionRange(caret, caret));
  }
  const availableModels = live.models[currentHost] ?? [];
  const selectedModel = (active?.model
    ? availableModels.find((item) => item.id === active.model || item.model === active.model)
    : availableModels.find((item) => item.id === modelByHost[currentHost])) ??
    availableModels.find((item) => item.isDefault) ?? availableModels[0];
  const availableEfforts = selectedModel?.efforts ?? [];
  const effortLabels: Record<string, string> = { minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: 'Max', ultra: 'Ultra' };
  const desiredEffort = active ? active.reasoningEffort : effortByHost[currentHost];
  const effectiveEffort = desiredEffort && availableEfforts.includes(desiredEffort)
    ? desiredEffort : selectedModel?.defaultEffort ?? '';
  const modelChangePending = Boolean(active && modelWorkingFor === conversationKey(active.hostId, active.id));
  function applyModelSelection(modelId: string, effort: string) {
    if (!active) {
      setModelByHost((current) => ({ ...current, [currentHost]: modelId }));
      setEffortByHost((current) => ({ ...current, [currentHost]: effort }));
      return;
    }
    if (modelChangePending) return;
    const threadId = active.id, hostId = active.hostId;
    const key = conversationKey(hostId, threadId);
    if (active.model === modelId && active.reasoningEffort === effort) return;
    setModelWorkingFor(key);
    void live.setThreadModel(hostId, threadId, modelId, effort).then(() => {
      live.clearContextUsage(hostId, threadId);
    }).catch(() => setNotice('模型或思考强度切换未确认，请刷新会话核对后重试')).finally(() => {
      setModelWorkingFor((value) => value === key ? null : value);
    });
  }
  const activeGoal = active ? live.goals[currentHost + ':' + active.id] : null;
  const activeQueue = active ? live.queues[currentHost + ':' + active.id] ?? [] : [];
  const contextUsage = active ? live.contextUsages[conversationKey(active.hostId, active.id)] : null;
  const contextPercent = contextUsage ? contextUsagePercent(contextUsage) : null;
  const compactPhase = active ? live.compactions[conversationKey(active.hostId, active.id)] : undefined;
  const compacting = compactionBusy(compactPhase);
  const displayedGoal = active ? activeGoal?.objective ?? '' : goal;
  const isRunning = active?.running === true;
  const { scrollerRef, contentRef, showJump, onScroll: onMessageScroll, jumpToLatest } =
    useFollowLatest(view === 'chat' && active ? conversationKey(active.hostId, active.id) : null,
      active?.messages, visibleLocalSubmissions, isRunning, live.agentActivityRevision);
  useEffect(() => { setPublicationTarget(null); }, [active?.hostId, active?.id]);
  function openAssistantFile(path: string, linkIndex: number, itemId?: string) {
    if (!active || !itemId) {
      setNotice('无法确认消息中的文件引用，请刷新对话后重试');
      return;
    }
    setPublicationTarget({
      hostId: active.hostId, threadId: active.id, itemId, linkIndex, path,
    });
  }
  async function revealPublicationFile(hostId: HostId, filePath: string) {
    const native = desktopBridge();
    if (!native) throw Error('DESKTOP_UNAVAILABLE');
    const result = await native.revealFile(hostId, filePath);
    if (!result.ok) throw Error(result.error ?? 'FILE_NOT_FOUND');
  }
  async function revealHostFile(hostId: HostId, filePath: string) {
    const native = desktopBridge();
    if (!native) return;
    try {
      const result = await native.revealFile(hostId, filePath);
      if (!result.ok) setNotice(result.error ?? '无法定位该电脑的文件');
    } catch { setNotice('无法定位文件，请检查桌面端连接设置'); }
  }
  useEffect(() => {
    if (live.status[currentHost] !== 'online') return;
    let liveEffect = true;
    void Promise.allSettled([
      live.request(currentHost, 'app/list', { limit: 100, forceRefetch: true }),
      live.request(currentHost, 'plugin/installed', {}).catch(() =>
        live.request(currentHost, 'plugin/list', { forceRefetch: true })),
    ]).then(([apps, plugins]) => {
      if (!liveEffect) return;
      const list = parseToolLogos(apps.status === 'fulfilled' ? apps.value : null,
        plugins.status === 'fulfilled' ? plugins.value : null);
      setToolLogos((old) => ({ ...old, [currentHost]: list }));
    });
    return () => { liveEffect = false; };
  }, [currentHost, live.status[currentHost]]);
  const permissionKey = active ? conversationKey(active.hostId, active.id) : null;
  const nextPermission = permissionKey ? nextPermissions[permissionKey] : undefined;
  const currentPermission = permissionKey ? live.threadPermissions[permissionKey] : permission;
  const selectedPermission = nextPermission ?? currentPermission;
  const CurrentPermissionIcon = permissionIcons[selectedPermission ?? 'custom'];
  const { prepareAttachments } = live;
  const connected = live.status[currentHost] === 'online';
  const [retryUpload, setRetryUpload] = useState(0);
  const [prepared, setPrepared] = useState<{
    host: HostId;
    images: typeof pastedImages;
    documents: typeof pastedDocuments;
    result: Awaited<ReturnType<typeof prepareAttachments>>;
  } | null>(null);
  const [preparingProgress, setPreparingProgress] = useState<number | null>(null);
  const [preparingFailed, setPreparingFailed] = useState(false);
  const attachmentsDisabled = Boolean(active && followUpMode === 'queue');
  const hasDraftAttachments = pastedImages.length + pastedDocuments.length > 0;
  const readyAttachments = prepared?.host === currentHost && prepared.images === pastedImages &&
    prepared.documents === pastedDocuments ? prepared.result : undefined;
  useEffect(() => {
    if (!connected || attachmentsDisabled || !hasDraftAttachments || readyAttachments) return;
    const controller = new AbortController();
    setPreparingProgress(0);
    setPreparingFailed(false);
    void prepareAttachments(currentHost, pastedImages.map(({ file }) => file),
      pastedDocuments.map(({ file }) => file), {
        pathHosts, signal: controller.signal,
        onUploadProgress: (received, total) => {
          if (!controller.signal.aborted) setPreparingProgress(Math.round(100 * received / total));
        },
      }).then((result) => {
        if (!controller.signal.aborted) setPrepared({
          host: currentHost, images: pastedImages, documents: pastedDocuments, result,
        });
      }, () => {
        if (!controller.signal.aborted) setPreparingFailed(true);
      });
    return () => controller.abort();
  }, [connected, currentHost, attachmentsDisabled, hasDraftAttachments, pastedImages, pastedDocuments,
    pathHosts, prepareAttachments, readyAttachments, retryUpload]);
  const canSend = Boolean(draft.trim() || pastedImages.length || pastedDocuments.length);
  const stopMode = isRunning && !canSend;
  const composerBusy = submitting || stopping || goalWorking || pendingPermission !== null || compacting;
  const permissionLabels: Record<PermissionMode, string> = {
    default: '默认权限', 'auto-review': '自动审查', 'read-only': '只读',
    'full-access': '完整访问权限', custom: '自定义（config.toml）',
  };

  // Streamed message deltas change Conversation.messages many times per second, but
  // the sidebar only needs metadata. Keep its sorting inputs stable until that
  // metadata actually changes (including status, title and recency updates).
  const sidebarSignature = JSON.stringify(conversations.filter((item) => !item.attachedToThreadId).map(({ id, hostId, title, status, project, archived, updatedAt }) =>
    [id, hostId, title, status, project, archived, updatedAt]));
  const sidebarConversations = useMemo<SidebarConversation[]>(() => conversations.filter((item) => !item.attachedToThreadId).map(({
    id, hostId, title, status, project, archived, updatedAt,
  }) => ({ id, hostId, title, status, project, archived, updatedAt })), [sidebarSignature]);
  const recents = useMemo(() => [...sidebarConversations].filter((item) =>
    (hostFilter === 'all' || item.hostId === hostFilter) &&
    Boolean(item.archived) === showArchived &&
    (showAllRecent || !item.project || showArchived)
  ).sort((a, b) => Number(pinnedIds.includes(conversationKey(b.hostId, b.id))) -
    Number(pinnedIds.includes(conversationKey(a.hostId, a.id))) ||
    b.updatedAt - a.updatedAt), [sidebarConversations, hostFilter, showAllRecent, showArchived, pinnedIds]);
  const showRecentRefreshStatus = sidebarRefreshing && !collapsedSections.includes('recent') && recents.length > recentLimit;
  const pinnedProjects = useMemo(() => projects.filter((item) =>
    pinnedProjectIds.includes(conversationKey(item.hostId, item.id)) &&
    (hostFilter === 'all' || item.hostId === hostFilter)), [projects, pinnedProjectIds, hostFilter]);
  const pinnedConversations = useMemo(() => sidebarConversations.filter((item) =>
    pinnedIds.includes(conversationKey(item.hostId, item.id)) && !item.archived &&
    (hostFilter === 'all' || item.hostId === hostFilter))
    .sort((a, b) => b.updatedAt - a.updatedAt), [sidebarConversations, pinnedIds, hostFilter]);
  const searchTerm = query.trim();
  const threadSearch = useThreadSearch(searchOpen, searchTerm, live.status, live.request);
  const disconnectedSearchHosts = hosts.filter(({ id }) => live.status[id] !== 'online');
  const searchConnected = disconnectedSearchHosts.length < hosts.length;
  const searchResults = !searchOpen || !searchConnected ? [] : searchTerm ? threadSearch.hits : conversations
    .filter((item) => !item.archived && live.status[item.hostId] === 'online')
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 25)
    .map((conversation) => ({ conversation, snippet: undefined }));
  // Compute completed-turn actions once per message snapshot, rather than
  // scanning the entire history for each item on every streaming delta.
  const turnActions = useMemo(() => {
    const byTurn = new Map<string, { lastIndex: number; terminal: boolean; answerText: string }>();
    const answers = new Map<string, string[]>();
    active?.messages.forEach((message, index) => {
      const id = message.turnId;
      if (!id) return;
      const entry = byTurn.get(id) ?? { lastIndex: index, terminal: false, answerText: '' };
      entry.lastIndex = index;
      if (['completed', 'interrupted', 'failed'].includes(message.turnStatus ?? '')) entry.terminal = true;
      if (message.role === 'assistant' && !message.kind && message.content) {
        const parts = answers.get(id) ?? [];
        parts.push(message.content);
        answers.set(id, parts);
      }
      byTurn.set(id, entry);
    });
    for (const [id, entry] of byTurn) entry.answerText = (answers.get(id) ?? []).join('\n\n');
    return byTurn;
  }, [active?.messages]);

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
  useEffect(() => () => {
    pastedImagesRef.current.forEach((img) => URL.revokeObjectURL(img.url));
  }, []);
  useEffect(() => { setRecentLimit(10); }, [showAllRecent, showArchived, hostFilter]);
  useEffect(() => { setQuotaDetail(null); }, [currentHost, sidebarOpen]);
  useEffect(() => { localStorage.setItem('codex-web-follow-up', followUpMode); }, [followUpMode]);
  useEffect(() => {
    try { localStorage.setItem('codex-web-unread-threads', JSON.stringify(unreadThreads)); }
    catch { /* Mark-as-unread remains available for the current session. */ }
  }, [unreadThreads]);
  useEffect(() => {
    const target = pendingDeepLink.current;
    if (!target || !conversations.some((c) => c.hostId === target.hostId && c.id === target.id)) return;
    pendingDeepLink.current = null;
    chooseConversation(target.hostId, target.id);
  }, [sidebarSignature]);
  useEffect(() => {
    const native = (window as Window & { ReactNativeWebView?: { postMessage: (message: string) => void } }).ReactNativeWebView;
    if (!native) return;
    native.postMessage('codexmobileui:active:' + JSON.stringify({
      hostId: view === 'chat' ? active?.hostId ?? null : null,
      threadId: view === 'chat' ? active?.id ?? null : null,
    }));
  }, [active?.hostId, active?.id, view]);
  useEffect(() => {
    const open = (event: Event) => {
      const target = (event as CustomEvent).detail as { hostId?: string; threadId?: string } | null;
      if (!target || !validHostId(target.hostId) || (hosts.length > 0 && !hosts.some(({ id }) => id === target.hostId)) ||
        !/^[a-zA-Z0-9_-]{8,256}$/.test(target.threadId ?? '')) return;
      const hostId = target.hostId as HostId;
      const threadId = target.threadId!;
      pendingDeepLink.current = { hostId, id: threadId };
      const known = conversations.some((c) => c.hostId === hostId && c.id === threadId);
      if (known) {
        pendingDeepLink.current = null;
        chooseConversation(hostId, threadId);
      } else void live.refresh(hostId).catch(() => undefined);
    };
    window.addEventListener('codexmobileui:open-thread', open);
    return () => window.removeEventListener('codexmobileui:open-thread', open);
  }, [sidebarSignature]);
  useEffect(() => {
    const open = (event: Event) => {
      const target = (event as CustomEvent).detail;
      const id = /^[a-f0-9-]{36}$/;
      if (!target || !validHostId(target.hostId) ||
          (hosts.length > 0 && !hosts.some(({ id }) => id === target.hostId)) ||
          typeof target.taskId !== 'string' || !id.test(target.taskId) ||
          typeof target.runId !== 'string' || !id.test(target.runId)) return;
      const { hostId, taskId, runId } = target;
      setReminderTarget((previous) => ({ hostId, taskId, runId, navigation: (previous?.navigation ?? 0) + 1 }));
      setView('tasks');
      setPopup(null);
      closeOnMobile();
    };
    window.addEventListener('codexmobileui:open-reminder', open);
    return () => window.removeEventListener('codexmobileui:open-reminder', open);
  }, [hosts]);
  function acceptPins(snapshot: SidebarPinsSnapshot) {
    if (snapshot.revision < pinsRevision.current) return;
    pinsRevision.current = snapshot.revision;
    setSharedPins(snapshot);
    localStorage.setItem('codex-web-shared-pins', JSON.stringify(snapshot));
  }
  async function refreshPins() {
    try { acceptPins(await fetchSidebarPins()); }
    catch { /* Offline browser keeps last successfully fetched pins. */ }
  }
  function acceptThreadCompletions(snapshot: ThreadCompletionsSnapshot) {
    if (snapshot.revision < completionsRevision.current) return;
    completionsRevision.current = snapshot.revision;
    setThreadCompletions(snapshot);
    writeCachedThreadCompletions(() => localStorage, snapshot);
  }
  async function refreshThreadCompletions() {
    try { acceptThreadCompletions(await fetchThreadCompletions()); }
    catch { /* Offline browser keeps the last completed snapshot. */ }
  }
  async function refreshSidebar() {
    if (sidebarRefreshBusy.current) return;
    sidebarRefreshBusy.current = true;
    setSidebarRefreshing(true);
    try {
      const results = await Promise.allSettled(hosts.map((host) => live.refresh(host.id)));
      await Promise.allSettled([refreshPins(), refreshThreadCompletions(),
        ...hosts.map((host) => live.refreshRateQuota(host.id))]);
      setNotice(results.some((result) => result.status === 'rejected')
        ? '部分电脑刷新失败，请检查连接' : '侧栏已刷新');
    } finally {
      sidebarRefreshBusy.current = false;
      setSidebarRefreshing(false);
    }
  }
  function resetSidebarPull() {
    sidebarTouchStart.current = null;
    sidebarPullLatest.current = 0;
    setSidebarPull(0);
  }
  function handleSidebarTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (!mobileLayout() || sidebarRefreshBusy.current || event.touches.length !== 1 ||
        event.currentTarget.scrollTop > 0) { resetSidebarPull(); return; }
    sidebarTouchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }
  function handleSidebarTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    const start = sidebarTouchStart.current;
    if (!start || event.touches.length !== 1) { resetSidebarPull(); return; }
    const touch = event.touches[0];
    const distance = sidebarPullDistance(start.x, start.y, touch.clientX, touch.clientY,
      event.currentTarget.scrollTop);
    sidebarPullLatest.current = distance;
    setSidebarPull(distance);
  }
  function handleSidebarTouchEnd() {
    const shouldRefresh = !!sidebarTouchStart.current && sidebarPullLatest.current >= SIDEBAR_PULL_THRESHOLD;
    resetSidebarPull();
    if (shouldRefresh) void refreshSidebar();
  }
  function beginSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || mobileLayout()) return;
    sidebarResize.current = {
      pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSidebarResizing(true);
    event.preventDefault();
  }
  function moveSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = sidebarResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setSidebarWidth(clampSidebarWidth(
      resize.startWidth + event.clientX - resize.startX, window.innerWidth));
    event.preventDefault();
  }
  function endSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = sidebarResize.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    sidebarResize.current = null;
    setSidebarResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }
  function resizeSidebarWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const maximum = clampSidebarWidth(Number.MAX_SAFE_INTEGER, window.innerWidth);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? maximum :
      sidebarWidth + (event.key === 'ArrowLeft' ? -10 : 10);
    setSidebarWidth(clampSidebarWidth(next, window.innerWidth));
  }
  async function changePin(pin: SidebarPin, pinned: boolean) {
    try { acceptPins(await setSidebarPin(pin, pinned)); }
    catch { setNotice('置顶未能保存到 6v，请检查主机连接'); }
  }
  async function changeThreadCompletion(thread: CompletedThread, completed: boolean) {
    try { acceptThreadCompletions(await setThreadCompletion(thread, completed)); }
    catch { setNotice('完成状态未能保存到 6v，请检查主机连接'); }
  }
  function toggleProject(key: string) {
    const closing = openedProjects.includes(key);
    setOpenedProjects((current) => closing
      ? current.filter((item) => item !== key)
      : current.includes(key) ? current : [...current, key]);
    if (closing) setProjectThreadLimits((current) => clearProjectThreadLimit(current, key));
  }
  useEffect(() => {
    void refreshPins();
    void refreshThreadCompletions();
    if (!sidebarOpen) return;
    const timer = window.setInterval(() => {
      void refreshPins();
      void refreshThreadCompletions();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [sidebarOpen]);
  useEffect(() => {
    try {
      saveSidebarPreferences(window.localStorage, {
        showAllRecent, collapsedHosts: hostCollapsed, openedProjects,
        collapsedSections, sidebarOpen, sidebarWidth,
      });
    } catch { /* No storage available in this WebView/browser profile. */ }
  }, [showAllRecent, hostCollapsed, openedProjects, collapsedSections, sidebarOpen, sidebarWidth]);
  useEffect(() => {
    const resize = () => setSidebarWidth((width) => clampSidebarWidth(width, window.innerWidth));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setQuery(''); setSearchOpen(true); setPopup(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault(); createNewChat(newHostRef.current);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false); setPopup(null); setGoalEditor(false); setImageViewer(null);
        setProjectCreateOpen(false); setContextMenu(null); setRenameTarget(null); setChatFind(null);
        setPublicationTarget(null);
        setSidePanelFor(null);
      }
    }
    function nativeBack(event: Event) {
      // Reply synchronously to Android: consuming root back would leave users stuck.
      if (imageViewer) { setImageViewer(null); event.preventDefault(); }
      else if (publicationTarget) { setPublicationTarget(null); event.preventDefault(); }
      else if (renameTarget) { setRenameTarget(null); event.preventDefault(); }
      else if (projectCreateOpen) { setProjectCreateOpen(false); event.preventDefault(); }
      else if (settingsOpen) {
        setSettingsOpen(false); setSettingsProject(null); event.preventDefault();
      }
      else if (quotaDetail) { setQuotaDetail(null); event.preventDefault(); }
      else if (searchOpen) { setSearchOpen(false); event.preventDefault(); }
      else if (contextMenu) {
        if (contextMenu.page === 'projects') setContextMenu({ ...contextMenu, page: 'main' });
        else setContextMenu(null);
        event.preventDefault();
      }
      else if (inlineRename) { setInlineRename(null); event.preventDefault(); }
      else if (chatFind) { setChatFind(null); event.preventDefault(); }
      else if (goalEditor) { setGoalEditor(false); event.preventDefault(); }
      else if (renaming) { setRenaming(false); event.preventDefault(); }
      else if (popup) { setPopup(null); event.preventDefault(); }
      else if (sidePanelFor && sidePanelFor === activeId) { setSidePanelFor(null); event.preventDefault(); }
      else if (sidebarOpen) { setSidebarOpen(false); event.preventDefault(); }
      else if (view === 'tasks') { setView('chat'); event.preventDefault(); }
      // Nothing remains: React Native moves the task to the Android background.
    }
    function nativeNewChat() { createNewChat(newHostRef.current); }
    function nativeToggleSidebar() { setSidebarOpen((open) => !open); }
    function nativeSearch() { setQuery(''); setSearchOpen(true); setPopup(null); }
    window.addEventListener('keydown', keydown);
    window.addEventListener('codexmobileui:back', nativeBack);
    window.addEventListener('codexdesktop:new-chat', nativeNewChat);
    window.addEventListener('codexdesktop:toggle-sidebar', nativeToggleSidebar);
    window.addEventListener('codexdesktop:search', nativeSearch);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('codexmobileui:back', nativeBack);
      window.removeEventListener('codexdesktop:new-chat', nativeNewChat);
      window.removeEventListener('codexdesktop:toggle-sidebar', nativeToggleSidebar);
      window.removeEventListener('codexdesktop:search', nativeSearch);
    };
  }, [imageViewer, publicationTarget, renameTarget, projectCreateOpen, settingsOpen, quotaDetail,
    searchOpen, contextMenu, inlineRename, chatFind, goalEditor, renaming,
    popup, sidebarOpen, view, sidePanelFor, activeId]);
  useEffect(() => {
    if (!popup && !goalEditor) return;
    // Dismiss by actual pointer target, not a full-screen button behind higher
    // stacking contexts. Other popup triggers must remain one-click switches.
    function dismissOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (popup && !target.closest('.popover,.recent-settings,[data-popup-trigger]')) setPopup(null);
      if (goalEditor && !target.closest('.goal-editor,.goal-pill')) setGoalEditor(false);
    }
    document.addEventListener('pointerdown', dismissOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointer, true);
  }, [popup, goalEditor]);
  function closeOnMobile() { if (mobileLayout()) setSidebarOpen(false); }
  function clearImages() {
    pastedImagesRef.current.forEach((img) => URL.revokeObjectURL(img.url));
    pastedImagesRef.current = [];
    setPastedImages([]);
    pastedDocumentsRef.current = [];
    setPastedDocuments([]);
  }
  function clearSubmittedImages(ids: ReadonlySet<string>) {
    const next = pastedImagesRef.current.filter((image) => {
      if (!ids.has(image.id)) return true;
      URL.revokeObjectURL(image.url);
      return false;
    });
    pastedImagesRef.current = next;
    setPastedImages(next);
  }
  function addImages(files: File[]) {
    if (attachmentsDisabled) return;
    const supported = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];
    if (!files.length) return;
    if (files.length + pastedImagesRef.current.length + pastedDocumentsRef.current.length > 4) {
      setNotice('每条消息最多粘贴或选择 4 张图片'); return;
    }
    if (files.some((file) => !supported.includes(file.type) || file.size > 8 * 1024 * 1024 || file.size < 8)) {
      setNotice('图片需为 PNG、JPG、WebP、GIF 或 BMP，单张不超过 8 MB'); return;
    }
    const incoming = files.map((file) => ({ id: file.name + ':' + Date.now() + ':' + Math.random(),
      file, url: URL.createObjectURL(file) }));
    pastedImagesRef.current = [...pastedImagesRef.current, ...incoming];
    setPastedImages(pastedImagesRef.current);
  }
  function addDocuments(files: File[]) {
    if (attachmentsDisabled) return;
    if (!files.length) return;
    if (files.length + pastedImagesRef.current.length + pastedDocumentsRef.current.length > 4) {
      setNotice('每条消息最多添加 4 个文件或图片'); return;
    }
    if (files.some((file) => !documentFileAllowed(file))) {
      setNotice('文件类型不支持，或名称、大小不符合限制（单个最多 8 MB）');
      return;
    }
    const added = files.map((file) => ({ id: localMessageId(), file }));
    pastedDocumentsRef.current = [...pastedDocumentsRef.current, ...added];
    setPastedDocuments(pastedDocumentsRef.current);
  }
  function removeDocument(id: string) {
    pastedDocumentsRef.current = pastedDocumentsRef.current.filter((item) => item.id !== id);
    setPastedDocuments(pastedDocumentsRef.current);
  }
  function handlePaste(e: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .flatMap((item) => { const file = item.getAsFile(); return file ? [file] : []; });
    if (files.length) { e.preventDefault(); addImages(files); }
  }
  function removeImage(id: string) {
    const image = pastedImagesRef.current.find((entry) => entry.id === id);
    if (image) URL.revokeObjectURL(image.url);
    pastedImagesRef.current = pastedImagesRef.current.filter((entry) => entry.id !== id);
    setPastedImages(pastedImagesRef.current);
  }
  function renderOptimisticSubmission(item: OptimisticSubmission) {
    return <div key={item.id} className="message message-user pending-message">
      <div className="user-bubble">
        {item.text && <div>{item.text}</div>}
        {item.imageCount > 0 && <div>{`图片 × ${item.imageCount}`}</div>}
        {(item.fileCount ?? 0) > 0 && <div>{`文件 × ${item.fileCount}`}</div>}
      </div>
      {item.status !== 'accepted' && <div className="pending-label">
        {item.status === 'sending' ? '正在发送' : '发送状态未确认 · 请刷新'}
      </div>}
    </div>;
  }

  function createNewChat(host = newHost, project: string | null = null) {
    // Navigating away from an existing chat should not erase the text the user typed.
    if (active && draft.trim()) {
      setDrafts((items) => ({ ...items, 'new:draft': draft }));
    }
    navigationKey.current = 'new:draft';
    setNewHost(host); setNewProject(project); setActiveId(null); setView('chat'); setSidePanelFor(null);
    clearImages(); setPopup(null); setGoal(''); setPlan(false); closeOnMobile();
    window.setTimeout(() => composeRef.current?.focus(), 0);
  }
  function chooseConversation(hostId: HostId, id: string, searchHit?: Conversation) {
    const item = conversations.find((c) => c.hostId === hostId && c.id === id) ?? searchHit;
    if (!item) return;
    setActiveId(conversationKey(hostId, id)); setNewHost(item.hostId); setNewProject(item.project);
    setSidePanelFor((old) => old === conversationKey(hostId, id) ? old : null);
    setUnreadThreads((old) => {
      if (!old[conversationKey(hostId, id)]) return old;
      const next = { ...old };
      delete next[conversationKey(hostId, id)];
      return next;
    });
    setView('chat'); setPopup(null); setSearchOpen(false); setRenaming(false); clearImages();
    setChatFind((old) => old?.key === conversationKey(hostId, id) ? old : null);
    void live.select(item.hostId, id, searchHit).then((messages) => {
      setOptimisticSubmissions((old) => reconcileOptimisticAfterRead(
        old, 'thread:' + conversationKey(item.hostId, id), messages));
    }).catch(() => setNotice('读取该电脑的实际聊天记录失败，请检查连接后刷新'));
    closeOnMobile();
  }
  function contextTarget(eventTarget: EventTarget | null): ContextTarget | null {
    if (!(eventTarget instanceof Element)) return null;
    const node = eventTarget.closest<HTMLElement>('[data-context-kind]');
    if (!node) return null;
    return contextTargetFromAttributes(node.dataset.contextKind ?? null,
      node.dataset.contextHost ?? null, node.dataset.contextId ?? null, node.dataset.contextOrigin,
      node.dataset.contextItem, node.dataset.contextLinkIndex);
  }
  function openContext(target: ContextTarget, x: number, y: number) {
    setPopup(null);
    setContextMenu({ ...target, x, y, page: 'main' });
  }
  function stopLongPress() {
    const pending = longPress.current;
    if (pending) window.clearTimeout(pending.timer);
    longPress.current = null;
  }
  function handleContextPointerDown(event: ReactPointerEvent) {
    if (event.pointerType !== 'touch' || longPress.current) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]')) return;
    const target = contextTarget(event.target);
    // Message text belongs to the native text-selection gesture. It is not
    // hijacked by our navigation-row long press.
    if (!target || target.kind === 'message') return;
    const pending = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      target, timer: 0, fired: false };
    pending.timer = window.setTimeout(() => {
      if (longPress.current !== pending) return;
      pending.fired = true;
      suppressNextClick.current = { hostId: target.hostId, id: target.id, until: Date.now() + 700 };
      openContext(target, pending.x, pending.y);
    }, 450);
    longPress.current = pending;
  }
  function handleContextPointerMove(event: ReactPointerEvent) {
    const pending = longPress.current;
    if (pending?.pointerId === event.pointerId &&
        gestureMoved(pending.x, pending.y, event.clientX, event.clientY)) stopLongPress();
  }
  function handleContextMenu(event: ReactMouseEvent) {
    const target = contextTarget(event.target);
    if (!target) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]')) return;
    // Keep Chrome/Electron's native Copy menu for already-selected message text.
    if (target.kind === 'message' && window.getSelection()?.toString().trim()) return;
    event.preventDefault();
    event.stopPropagation();
    if (longPress.current?.fired && longPress.current.target.id === target.id) return;
    openContext(target, event.clientX, event.clientY);
  }
  function handleContextClick(event: ReactMouseEvent) {
    const consumed = suppressNextClick.current;
    if (!consumed) return;
    const target = contextTarget(event.target);
    if (Date.now() > consumed.until) { suppressNextClick.current = null; return; }
    if (target?.hostId === consumed.hostId && target.id === consumed.id) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick.current = null;
    }
  }
  function markUnread(hostId: HostId, threadId: string, unread: boolean) {
    const key = conversationKey(hostId, threadId);
    setUnreadThreads((old) => {
      const next = { ...old };
      if (unread) next[key] = true;
      else delete next[key];
      return next;
    });
    setNotice(unread ? '已在此设备标为未读' : '已标为已读');
  }
  function copyContextText(value: string, label: string) {
    void copyToClipboard(value).then(() => setNotice(label + '已复制'))
      .catch(() => setNotice('无法访问剪贴板，请检查系统权限'));
  }
  function openChatFind(hostId: HostId, id: string) {
    chooseConversation(hostId, id);
    setChatFind({ key: conversationKey(hostId, id), query: '', current: -1 });
  }
  function beginContextRename(target: RenameTarget) {
    setRenameTarget(target);
    setRenameValue(target.original);
    setContextMenu(null);
  }
  async function saveContextRename() {
    const target = renameTarget;
    const name = renameValue.replace(/\s+/g, ' ').trim();
    if (!target || contextBusy) return;
    if (!name || [...name].length > 80) { setNotice('名称需要 1–80 字'); return; }
    if (name === target.original) { setRenameTarget(null); return; }
    setContextBusy(true);
    try {
      if (target.kind === 'thread') await live.renameThread(target.hostId, target.id, name);
      else {
        await live.request(target.hostId, 'project/update', { projectId: target.id, name });
        await live.refresh(target.hostId);
      }
      setRenameTarget(null);
    } catch { setNotice('服务器未确认重命名，请刷新后核对'); }
    finally { setContextBusy(false); }
  }
  async function modifyThread(target: { hostId: HostId; id: string }, action: 'archive' | 'delete' | 'move',
    projectId?: string) {
    if (contextBusy) return;
    const item = conversations.find((c) => c.hostId === target.hostId && c.id === target.id);
    if (!item) { setNotice('对话不存在或尚未同步'); return; }
    if (action === 'delete' && !window.confirm('确认永久删除这条聊天？此操作无法撤销。')) return;
    setContextBusy(true);
    try {
      if (action === 'archive') await live.request(target.hostId,
        item.archived ? 'thread/unarchive' : 'thread/archive', { threadId: target.id });
      else if (action === 'delete') await live.request(target.hostId, 'thread/delete', { threadId: target.id });
      else await live.moveThread(target.hostId, target.id, projectId ?? '');
      if (action === 'delete') live.forgetDeletedThread(target.hostId, target.id);
      if ((action === 'delete' || action === 'archive') &&
          activeId === conversationKey(target.hostId, target.id)) createNewChat(target.hostId);
      await live.refresh(target.hostId).catch(() =>
        setNotice(action === 'move' ? '已移动对话，列表刷新失败' : '操作已确认，列表刷新失败'));
    } catch { setNotice('服务器未确认该操作，请刷新列表核对后重试'); }
    finally { setContextBusy(false); }
  }
  async function deleteProject(project: NativeProject) {
    if (contextBusy || !window.confirm('确认删除项目“' + project.name + '”？项目对应的目录不会被本界面主动删除。')) return;
    setContextBusy(true);
    try {
      await live.request(project.hostId, 'project/delete', { projectId: project.id });
      await live.refresh(project.hostId);
    } catch { setNotice('服务器未确认删除项目，请刷新后核对'); }
    finally { setContextBusy(false); }
  }
  async function shareThread(hostId: HostId, id: string, title: string) {
    const url = threadLink(window.location.origin + window.location.pathname, hostId, id);
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title, url }); return; }
      catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    copyContextText(url, '内网会话链接');
  }
  function openPastedImageViewer(image: PastedImage) {
    try {
      setImageViewer(viewerSourceFromBlob(image.file, image.url,
        'pasted-image:' + image.id, image.file.name));
    } catch {
      setNotice('图片格式或大小不受支持');
    }
  }
  async function openContextImageViewer(url: string) {
    try {
      setImageViewer(await viewerSourceFromBlobUrl(url));
    } catch {
      setNotice('图片已不可用，请刷新对话后重试');
    }
  }
  async function copyContextImage(url: string) {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        setNotice('当前 WebView 不支持直接复制图片，请打开原图后使用系统操作');
        return;
      }
      const blob = await (await fetch(url)).blob();
      const png = blob.type === 'image/png' ? blob : await new Promise<Blob>((resolve, reject) => {
        const bitmap = new window.Image();
        bitmap.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.naturalWidth; canvas.height = bitmap.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(Error('CANVAS_UNAVAILABLE')); return; }
          ctx.drawImage(bitmap, 0, 0);
          canvas.toBlob((result) => result ? resolve(result) : reject(Error('PNG_UNAVAILABLE')), 'image/png');
        };
        bitmap.onerror = reject;
        bitmap.src = url;
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setNotice('图片已复制');
    } catch { setNotice('系统不允许复制图片，请查看原图'); }
  }
  function toggle<T>(items: T[], item: T, setter: (items: T[]) => void) {
    setter(items.includes(item) ? items.filter((value) => value !== item) : [...items, item]);
  }
  function toggleSection(id: 'pinned' | 'projects' | 'recent') {
    toggle(collapsedSections, id, setCollapsedSections);
  }
  function send() {
    if (sendBusy.current || stopping || pendingPermission || compacting) return;
    if (stopMode) { stopTurn(); return; }
    if (live.status[currentHost] !== 'online') { setNotice('电脑尚未连接，消息仍保留在输入框'); return; }
    const value = draft.trim();
    const nativeMentions = selectedNativeMentions(value, chosenMentions[mentionSelectionKey] ?? []);
    if (!value && !hasDraftAttachments) return;
    if (hasDraftAttachments && !readyAttachments) return;
    if (hasDraftAttachments && attachmentsDisabled) {
      setNotice('排队模式只支持文本，请切换到引导以发送附件'); return;
    }
    sendBusy.current = true;
    setSubmitting(true);
    const sendingHost = currentHost;
    const sendingKey = draftKey;
    const sendingRevision = draftRevisions.current[sendingKey] ?? 0;
    const submittedImageIds = new Set(pastedImages.map((entry) => entry.id));
    const submittedDocumentIds = new Set(pastedDocuments.map((entry) => entry.id));
    const localId = 'web-submit-' + localMessageId();
    const controller = new AbortController();
    uploadController.current = controller;
    const hasAttachments = pastedImages.length + pastedDocuments.length > 0;
    setUploadPhase('sending');
    setOptimisticSubmissions((old) => addOptimisticSubmission(old, {
      id: localId, hostId: sendingHost, key: sendingKey, text: value,
      submittedText: value, imageCount: pastedImages.length, fileCount: pastedDocuments.length,
    }, active?.messages ?? []));
    setUploadProgress(hasAttachments ? 100 : null);
    void live.send(sendingHost, active?.id ?? null, currentProject, value, {
      pathHosts,
      model: selectedModel?.id, effort: effectiveEffort || undefined,
      mentions: nativeMentions,
      permissionMode: permission, nextPermission, plan, goal: active ? undefined : goal, followUpMode,
      onPermissionApplied: () => {
        if (!permissionKey) return;
        setNextPermissions((old) => {
          if (old[permissionKey] !== nextPermission) return old;
          const next = { ...old };
          delete next[permissionKey];
          return next;
        });
      },
      preparedAttachments: readyAttachments,
      images: pastedImages.map((entry) => entry.file),
      documents: pastedDocuments.map((entry) => entry.file),
      signal: controller.signal,
      onUploadsDone: () => { uploadController.current = null; setUploadPhase('sending'); },
      onUploadProgress: (received, total) =>
        setUploadProgress(total > 0 ? Math.round(received / total * 100) : null),
      onCreated: (threadId) => {
        const newKey = 'thread:' + conversationKey(sendingHost, threadId);
        if (navigationKey.current === sendingKey) {
          navigationKey.current = newKey;
          setActiveId(conversationKey(sendingHost, threadId));
        }
        draftRevisions.current[newKey] = draftRevisions.current[sendingKey] ?? sendingRevision;
        setDrafts((items) => ({ ...items, [newKey]: items[newKey] ?? items[sendingKey] ?? value }));
        const nextMentionsKey = mentionScope + ':' + newKey;
        setChosenMentions((old) => ({ ...old,
          [nextMentionsKey]: old[nextMentionsKey] ?? old[mentionSelectionKey] ?? [] }));
        setOptimisticSubmissions((old) => old.map((item) => item.id === localId
          ? { ...item, key: newKey, originKey: item.originKey ?? item.key } : item));
      },
      onAccepted: (threadId, turnId, steered) => {
        const acceptedKey = 'thread:' + conversationKey(sendingHost, threadId);
        setOptimisticSubmissions((old) => old.map((item) => item.id === localId
          ? { ...item, key: acceptedKey, turnId, steered,
            ...(item.key === acceptedKey ? {} : { originKey: item.originKey ?? item.key }) } : item));
      },
    }).then((result) => {
        const resultKey = 'thread:' + conversationKey(sendingHost, result.threadId);
        const stillViewingSend = navigationKey.current === sendingKey ||
          navigationKey.current === resultKey;
        if (stillViewingSend) setActiveId(conversationKey(sendingHost, result.threadId));
        setDrafts((items) => {
          const next = { ...items };
          for (const key of new Set([sendingKey, resultKey])) {
            if ((draftRevisions.current[key] ?? 0) === sendingRevision &&
                (items[key] ?? '').trim() === value) next[key] = '';
          }
          return next;
        });
        setChosenMentions((old) => {
          const next = { ...old };
          if ((draftRevisions.current[sendingKey] ?? 0) === sendingRevision)
            next[mentionSelectionKey] = [];
          if ((draftRevisions.current[resultKey] ?? 0) === sendingRevision)
            next[mentionScope + ':' + resultKey] = [];
          return next;
        });
        if (!active && stillViewingSend) setGoal('');
        clearSubmittedImages(submittedImageIds);
        pastedDocumentsRef.current = pastedDocumentsRef.current.filter((item) =>
          !submittedDocumentIds.has(item.id));
        setPastedDocuments(pastedDocumentsRef.current);
        setOptimisticSubmissions((old) => result.queued
          ? old.filter((item) => item.id !== localId)
          : old.map((item) => item.id === localId ? { ...item, status: 'accepted' } : item));
        if (stillViewingSend) setPopup(null);
        if (result.goalFailed) setNotice('消息已发送，但目标设置失败，请单独重试');
      }).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'PATH_AMBIGUOUS') {
          setOptimisticSubmissions((old) => old.filter((item) => item.id !== localId));
          setNotice('同一个绝对路径在两台电脑都存在，请改用明确的网络共享路径后再发送');
          return;
        }
        if (error instanceof Error && error.message === 'NEXT_PERMISSION_UNCONFIRMED') {
          setOptimisticSubmissions((old) => old.filter((item) => item.id !== localId));
          setNotice('下一轮的权限未获确认，草稿和权限选择已保留');
          return;
        }
        const knownRejection = error instanceof Error && [
          'TEXT_OR_IMAGE_REQUIRED_OR_TOO_LONG', 'IMAGE_FORMAT_OR_SIZE_UNSUPPORTED',
          'DOCUMENT_FORMAT_OR_SIZE_UNSUPPORTED', 'DOCUMENT_REFERENCES_TOO_LONG',
          'QUEUE_IMAGES_UNSUPPORTED', 'PATH_HOSTS_UNAVAILABLE',
          'PATH_RESOLVE_UNCONFIRMED', 'PATH_RESOLVE_FAILED',
          'PERMISSION_NOT_ALLOWED', 'MODEL_NOT_AVAILABLE', 'EFFORT_NOT_AVAILABLE',
          'PLAN_MODEL_UNAVAILABLE', 'IMAGE_REQUEST_REJECTED', 'IMAGE_UPLOAD_OFFSET_MISMATCH',
        ].includes(error.message);
        if (controller.signal.aborted) {
          setOptimisticSubmissions((old) => old.filter((item) => item.id !== localId));
          setNotice('附件上传已取消，草稿和所选文件仍保留');
        } else if (knownRejection) {
          setOptimisticSubmissions((old) => old.filter((item) => item.id !== localId));
          setNotice('发送未开始，草稿和附件仍在输入框，可修改后重试');
        } else {
          setOptimisticSubmissions((old) => old.map((item) => item.id === localId
            ? { ...item, status: 'uncertain' } : item));
          setNotice('服务器未确认发送结果，草稿已保留；请刷新实际记录后再决定是否重发');
        }
      })
      .finally(() => {
        if (uploadController.current === controller) uploadController.current = null;
        sendBusy.current = false; setSubmitting(false); setUploadProgress(null); setUploadPhase(null);
      });
  }
  function stopTurn() {
    if (!active?.activeTurnId || composerBusy) return;
    setStopping(true);
    void live.interrupt(active.hostId, active.id)
      .catch(() => setNotice('停止状态未确认，请刷新核对'))
      .finally(() => setStopping(false));
  }
  function selectPermission(mode: PermissionMode) {
    if (pendingPermission || submitting) return;
    const profile = mode === 'default' || mode === 'auto-review' ? ':workspace' :
      mode === 'read-only' ? ':read-only' : mode === 'full-access' ? ':danger-full-access' : null;
    if (profile && !(live.permissions[currentHost] ?? []).some((p) => p.id === profile && p.allowed)) {
      setNotice('电脑的原生权限配置未允许此选项');
      return;
    }
    if (mode === 'full-access' && !window.confirm('完整访问权限允许 Codex 在对应电脑上执行高风险操作。确认在后续消息中使用？')) return;
    if (active && permissionKey && (active.running || active.syncPending || nextPermission)) {
      setNextPermissions((old) => ({ ...old, [permissionKey]: mode }));
      setPopup(null);
      setNotice('权限将在下次从输入框启动轮次时应用');
    } else if (active) {
      setPendingPermission(mode);
      void live.setThreadPermission(active.hostId, active.id, mode)
        .then(() => setPopup((opened) => opened === 'permission' ? null : opened))
        .catch(() => setNotice('服务器未确认权限变更，当前勾选保留原模式；请刷新会话核对'))
        .finally(() => setPendingPermission(null));
    } else { setPermission(mode); setPopup(null); }
  }
  function saveGoal() {
    const objective = goalDraft.trim();
    if (!objective || Array.from(objective).length > 4000) { setNotice('目标需要 1–4000 字'); return; }
    if (goalWorking) return;
    if (!active) {
      if (sendBusy.current) return;
      sendBusy.current = true;
      setGoalWorking(true); setSubmitting(true);
      void live.send(currentHost, null, currentProject, '', {
        model: selectedModel?.id, effort: effectiveEffort || undefined,
        permissionMode: permission, goal: objective,
        onCreated: (id) => setActiveId(conversationKey(currentHost, id)),
      }).then(({ threadId }) => {
        setActiveId(conversationKey(currentHost, threadId));
        setGoal(''); setGoalEditor(false);
      }).catch(() => setNotice('目标设置结果未确认，请刷新电脑会话核对后再重试'))
        .finally(() => { sendBusy.current = false; setGoalWorking(false); setSubmitting(false); });
      return;
    }
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
  function phoneComposer() {
    return Boolean((window as Window & { ReactNativeWebView?: unknown }).ReactNativeWebView) ||
      window.matchMedia('(max-width: 800px) and (pointer: coarse)').matches;
  }
  function handleEnter(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && phoneComposer()) return;
    if (mentionOpen) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMentionOpen(false); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); setMentionIndex((n) => mentionOptions.length
          ? (n + (e.key === 'ArrowDown' ? 1 : -1) + mentionOptions.length) % mentionOptions.length : 0);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (mentionOptions.length) chooseMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)]);
        else setMentionOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  }
  function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    addImages(Array.from(e.target.files ?? []));
    e.target.value = '';
  }
  function handleDocuments(e: ChangeEvent<HTMLInputElement>) {
    addDocuments(Array.from(e.target.files ?? []));
    e.target.value = '';
  }
  function beginInlineRename(item: SidebarConversation, location: RenameLocation) {
    if (mobileLayout() || inlineRenameBusy.current) return;
    setPopup(null);
    setInlineRename({ hostId: item.hostId, threadId: item.id,
      location, original: item.title, draft: item.title, saving: false });
  }
  function saveInlineRename(item: SidebarConversation, location: RenameLocation, value: string) {
    const editing = inlineRename;
    if (!editing || editing.hostId !== item.hostId || editing.threadId !== item.id ||
        editing.location !== location || inlineRenameBusy.current) return;
    const name = value.replace(/\s+/g, ' ').trim();
    if (name === editing.original.replace(/\s+/g, ' ').trim()) {
      setInlineRename(null);
      return;
    }
    if (!name || [...name].length > 80) {
      setNotice('标题需为 1–80 字');
      requestAnimationFrame(() => inlineRenameInputRef.current?.focus());
      return;
    }
    inlineRenameBusy.current = true;
    setInlineRename((current) => current ? { ...current, draft: value, saving: true } : current);
    void live.renameThread(item.hostId, item.id, name).then(() => setInlineRename(null))
      .catch(() => {
        setNotice('电脑未确认重命名，请修改或重试');
        setInlineRename((current) => current ? { ...current, saving: false } : current);
        requestAnimationFrame(() => inlineRenameInputRef.current?.focus());
      }).finally(() => { inlineRenameBusy.current = false; });
  }
  function conversationRow(item: SidebarConversation, nested = false, location: RenameLocation = 'recent') {
    const key = conversationKey(item.hostId, item.id);
    const pinned = pinnedIds.includes(key);
    const completed = completedThreadIds.includes(key);
    const editingHere = inlineRename?.hostId === item.hostId &&
      inlineRename.threadId === item.id && inlineRename.location === location;
    return <div key={key} className={'conversation-row-wrap context-press-target' + (nested ? ' nested' : '')}
      data-context-kind="thread" data-context-host={item.hostId} data-context-id={item.id}>
      <button className={'conversation-completion' + (completed ? ' is-completed' : '')}
        type="button" role="checkbox" aria-checked={completed}
        title={completed ? '标记为未完成' : '标记为完成'}
        aria-label={(completed ? '标记为未完成：' : '标记为完成：') + item.title}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void changeThreadCompletion({ hostId: item.hostId, threadId: item.id }, !completed);
        }}>
        <span className="conversation-completion-box">
          {completed && <Check size={14} aria-hidden="true"/>}
        </span>
      </button>
      {editingHere ? <div className={'conversation-row conversation-rename-row' + (nested ? ' nested' : '') +
        (activeId === key ? ' is-selected' : '')}>
        <span className="conversation-name is-editing">
          <input className="conversation-inline-input" ref={inlineRenameInputRef} type="text"
            aria-label={'重命名聊天：' + item.title} autoFocus maxLength={80}
            disabled={inlineRename.saving} value={inlineRename.draft}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setInlineRename((current) => current ? { ...current, draft: event.target.value } : current)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !inlineRename.saving) {
                event.preventDefault(); event.stopPropagation(); setInlineRename(null);
              } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault(); event.stopPropagation();
                saveInlineRename(item, location, event.currentTarget.value);
              }
            }}
            onBlur={(event) => saveInlineRename(item, location, event.currentTarget.value)} />
        </span>
        <span className="conversation-end">{!nested && <span className="conversation-host">{item.hostId}</span>}
          {inlineRename.saving ? <RefreshCw className="conversation-rename-spinner" size={13} aria-label="正在保存标题" /> :
            <StatusMark status={unreadThreads[key] && item.status !== 'running' ? 'unread' : item.status} />}
        </span>
      </div> : <button className={'conversation-row' + (nested ? ' nested' : '') +
        (activeId === key ? ' is-selected' : '')}
        onClick={() => chooseConversation(item.hostId, item.id)}>
        <span className="conversation-name" onDoubleClick={(event) => {
          event.preventDefault(); event.stopPropagation(); beginInlineRename(item, location);
        }}>{item.title}</span>
        <span className="conversation-end">{!nested && <span className="conversation-host">{item.hostId}</span>}<StatusMark status={unreadThreads[key] && item.status !== 'running' ? 'unread' : item.status} /></span>
      </button>}
      <div className="conversation-row-actions">
        <button className={'row-pin' + (pinned ? ' is-pinned' : '')} title={pinned ? '取消置顶对话' : '置顶对话'}
          aria-label={(pinned ? '取消置顶 ' : '置顶 ') + item.title}
          onClick={() => { void changePin({ type: 'thread', hostId: item.hostId, id: item.id }, !pinned); }}><Pin size={14}/></button>
        <button className="row-archive" title={item.archived ? '取消归档对话' : '归档对话'}
          aria-label={(item.archived ? '取消归档 ' : '归档 ') + item.title}
          disabled={contextBusy || editingThread} onClick={() => { void modifyThread(item, 'archive'); }}><Archive size={14}/></button>
      </div>
    </div>;
  }
  function projectRow(project: NativeProject) {
    const key = conversationKey(project.hostId, project.id);
    const expanded = openedProjects.includes(key);
    const threadLimit = projectThreadLimits[key] ?? PROJECT_THREAD_PREVIEW_LIMIT;
    const pinned = pinnedProjectIds.includes(key);
    const children = sidebarConversations.filter((item) =>
      item.project === project.id && item.hostId === project.hostId && !item.archived);
    const visibleChildren = visibleProjectThreads(children, threadLimit);
    return <div className="tree-project" key={key}>
      <div className="project-line context-press-target" data-context-kind="project"
        data-context-host={project.hostId} data-context-id={project.id}>
        <button className="project-disclosure" aria-label={(expanded ? '收起 ' : '展开 ') + project.name}
          aria-expanded={expanded} onClick={() => toggleProject(key)}>
          <ChevronRight size={17} className={expanded ? 'chevron-open' : ''}/></button>
        <button className="project-name" onClick={() => toggleProject(key)}>
          <Folder size={19}/><span>{project.name}</span></button>
        <button className={'row-pin project-pin' + (pinned ? ' is-pinned' : '')}
          aria-label={(pinned ? '取消置顶 ' : '置顶 ') + project.name}
          title={pinned ? '取消置顶项目' : '置顶项目'}
          onClick={() => { void changePin({ type: 'project', hostId: project.hostId, id: project.id }, !pinned); }}><Pin size={15}/></button>
        <button className="project-new" title={'在 ' + project.name + ' 新建聊天'}
          aria-label={'在 ' + project.name + ' 新建聊天'}
          onClick={() => createNewChat(project.hostId, project.id)}><Plus size={17}/></button>
      </div>
      {expanded && <div className="nested-conversations">{children.length
        ? <>
            {visibleChildren.map((item) => conversationRow(item, true, 'project'))}
            {children.length > threadLimit && <button className="project-thread-toggle"
              onClick={() => setProjectThreadLimits((current) => ({
                ...current, [key]: nextProjectThreadLimit(current[key] ?? PROJECT_THREAD_PREVIEW_LIMIT, children.length),
              }))}>
              加载更多对话
            </button>}
          </>
        : <button className="empty-project" onClick={() => createNewChat(project.hostId, project.id)}>＋ 新建项目聊天</button>}</div>}
    </div>;
  }
  function latestForkableTurnId(conversation: Conversation | SidebarConversation | null): string | null {
    if (!conversation || !('messages' in conversation)) return null;
    for (let index = conversation.messages.length - 1; index >= 0; index--) {
      const message = conversation.messages[index];
      if (message.role === 'assistant' && !message.kind && message.turnId &&
          ['completed', 'interrupted', 'failed'].includes(message.turnStatus ?? '')) {
        return message.turnId;
      }
    }
    return null;
  }
  function forkFromTurn(conversation: Conversation, lastTurnId: string) {
    const key = conversationKey(conversation.hostId, conversation.id);
    if (forkBusy.current) return;
    forkBusy.current = true;
    setForkingThread(key);
    void live.forkThread(conversation.hostId, conversation.id, lastTurnId).then((newId) => {
      setActiveId(conversationKey(conversation.hostId, newId));
      setNewHost(conversation.hostId);
      setNewProject(conversation.project);
      setView('chat');
      setPopup(null);
      setContextMenu(null);
      closeOnMobile();
      setNotice('已从所选回复创建新分支');
    }).catch(() => {
      setNotice('分支结果未确认，已保留原聊天；请刷新列表核对后再试');
    }).finally(() => {
      forkBusy.current = false;
      setForkingThread(null);
    });
  }
  function actionForCurrent(action: 'pin' | 'archive' | 'delete' | 'copy' | 'fork') {
    if (!active) return;
    if (action === 'copy') {
      void copyToClipboard(active.id).then(() => setNotice('已复制对话 ID'))
        .catch(() => setNotice('浏览器不允许复制，请检查剪贴板权限'));
    }
    if (action === 'pin') void changePin({ type: 'thread', hostId: active.hostId, id: active.id },
      !pinnedIds.includes(conversationKey(active.hostId, active.id)));
    if (action === 'fork') {
      const lastTurnId = latestForkableTurnId(active);
      if (lastTurnId) forkFromTurn(active, lastTurnId);
      return;
    }
    if (action === 'archive') {
      if (editingThread) return;
      setEditingThread(true);
      const targetArchive = !active.archived;
      void live.request(active.hostId, targetArchive ? 'thread/archive' : 'thread/unarchive', { threadId: active.id }).then(() => {
        createNewChat(active.hostId);
        void live.refresh(active.hostId);
      }).catch(() => setNotice('归档操作结果未确认，请刷新该电脑的聊天记录核对'))
        .finally(() => setEditingThread(false));
    }
    if (action === 'delete') {
      if (editingThread || !window.confirm('确认永久删除当前电脑中的这条聊天？此操作无法撤销。')) return;
      setEditingThread(true);
      const hostId = active.hostId, threadId = active.id;
      void live.request(hostId, 'thread/delete', { threadId }).then(() => {
        live.forgetDeletedThread(hostId, threadId);
        createNewChat(hostId);
        void live.refresh(hostId);
      }).catch(() => setNotice('删除结果未确认，请先刷新会话列表，避免重复操作'))
        .finally(() => setEditingThread(false));
    }
    setPopup(null);
  }
  function saveRename() {
    if (!active || editingThread) return;
    const name = renameDraft.replace(/\s+/g, ' ').trim();
    if (!name || [...name].length > 80) { setNotice('标题需要 1–80 字'); return; }
    setEditingThread(true);
    void live.renameThread(active.hostId, active.id, name).then(() => {
      setRenaming(false); setPopup(null);
    }).catch(() => setNotice('电脑未确认改名，请刷新列表核对'))
      .finally(() => setEditingThread(false));
  }

  const contextThread = contextMenu?.kind === 'thread'
    ? conversations.find((item) => item.hostId === contextMenu.hostId && item.id === contextMenu.id) : null;
  const contextProject = contextMenu?.kind === 'project'
    ? projects.find((item) => item.hostId === contextMenu.hostId && item.id === contextMenu.id) : null;
  const contextMessage = contextMenu?.kind === 'message' && active?.hostId === contextMenu.hostId
    ? active.messages.find((item) => item.id === contextMenu.id) : null;
  const chatFindMatches = active && chatFind?.key === conversationKey(active.hostId, active.id) &&
    chatFind.query.trim() ? active.messages.flatMap((message, index) =>
      message.content.toLocaleLowerCase().includes(chatFind.query.toLocaleLowerCase().trim()) ? [index] : []) : [];
  function advanceChatFind(direction: 1 | -1) {
    if (!chatFind || chatFindMatches.length === 0) return;
    const current = chatFind.current;
    const next = current < 0 ? (direction === 1 ? 0 : chatFindMatches.length - 1) :
      (current + direction + chatFindMatches.length) % chatFindMatches.length;
    setChatFind({ ...chatFind, current: next });
    const index = chatFindMatches[next];
    requestAnimationFrame(() => {
      scrollerRef.current?.querySelector<HTMLElement>('[data-message-index="' + index + '"]')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
  function contextOption(label: string, Icon: LucideIcon, action: () => void,
    disabled = false, danger = false) {
    return <button type="button" role="menuitem" className={danger ? 'danger-action' : ''}
      disabled={contextBusy || disabled} onClick={() => { setContextMenu(null); action(); }}>
      <Icon size={16} aria-hidden="true"/><span>{label}</span>
    </button>;
  }
  function setSideDraft(key: string, value: string, expected?: string) {
    setSideDrafts((old) => {
      if (expected !== undefined && (old[key] ?? '') !== expected) return old;
      const next = { ...old };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }
  function openSideChat() {
    if (!active || active.attachedToThreadId) return;
    const key = conversationKey(active.hostId, active.id);
    if (sidePanelFor === key) { setSidePanelFor(null); return; }
    const selection = window.getSelection();
    const selected = selection && selection.rangeCount && contentRef.current?.contains(selection.anchorNode) &&
      contentRef.current?.contains(selection.focusNode) ? selection.toString().trim().slice(0, 4000) : '';
    if (selected) {
      const draftKey = key + ':new';
      const quote = selected.split('\n').map((line) => '> ' + line).join('\n');
      setSideDrafts((old) => ({ ...old, [draftKey]: quote + '\n\n' + (old[draftKey] ?? '') }));
    }
    setSideInitialSelection(selected || undefined);
    if (mobileLayout()) setSidebarOpen(false);
    setSidePanelFor(key); setPopup(null);
  }
  const sidePanelOpen = Boolean(active && view === 'chat' && sidePanelFor === activeId);
  useEffect(() => {
    if (!sidePanelOpen) return;
    const closeNarrowSidebar = () => { if (mobileLayout()) setSidebarOpen(false); };
    closeNarrowSidebar();
    window.addEventListener('resize', closeNarrowSidebar);
    return () => window.removeEventListener('resize', closeNarrowSidebar);
  }, [sidePanelOpen]);
  return <><DesktopTitlebar/><div className={'app-shell' + (sidebarOpen ? ' sidebar-is-open' : ' sidebar-is-closed') + (desktopBridge()?.openMenu ? ' native-desktop-app' : '') + (sidePanelOpen ? ' side-chat-is-open' : '')}
    onPointerDownCapture={handleContextPointerDown}
    onPointerMoveCapture={handleContextPointerMove}
    onPointerUpCapture={stopLongPress}
    onPointerCancelCapture={stopLongPress}
    onScrollCapture={stopLongPress}
    onContextMenuCapture={handleContextMenu}
    onClickCapture={handleContextClick}>
    {sidebarOpen && <button aria-label="关闭侧边栏" className="mobile-scrim" onClick={() => setSidebarOpen(false)} />}
    <aside className={'sidebar-rail' + (sidebarResizing ? ' is-resizing' : '')}
      aria-label="电脑和会话导航"
      style={{ '--sidebar-width': sidebarWidth + 'px' } as CSSProperties}>
      <div className="sidebar-inner">
        <div className="sidebar-head">
          <strong className="app-wordmark">CodexMobile</strong>
          <button className="circle-tool sidebar-search" aria-label="搜索" title="搜索聊天 (Ctrl+K)" onClick={() => { setQuery(''); setSearchOpen(true); }}><Search size={23} /></button>
        </div>
        {(sidebarPull > 0 || sidebarRefreshing) && <div className="sidebar-pull-status" role="status" aria-live={showRecentRefreshStatus ? 'off' : 'polite'}>
          <RefreshCw size={16} className={sidebarRefreshing ? 'sidebar-refresh-spinner' : ''}/>
          {sidebarRefreshing ? '正在刷新…' : sidebarPull >= SIDEBAR_PULL_THRESHOLD ? '松手刷新' : '下拉刷新'}
        </div>}
        <div className="sidebar-scroll" onTouchStart={handleSidebarTouchStart}
          onTouchMove={handleSidebarTouchMove} onTouchEnd={handleSidebarTouchEnd}
          onTouchCancel={resetSidebarPull}>
          <div className="sidebar-main-actions">
            <div className="filter-wrap">
              <button data-popup-trigger className="host-filter" aria-expanded={popup === 'host'} onClick={() => setPopup(popup === 'host' ? null : 'host')}>
                <Monitor size={19} /><span>{hostFilter === 'all' ? '全部电脑' : hostFilter}</span><ChevronDown size={16} />
              </button>
              {popup === 'host' && <div className="popover host-filter-popover"><span className="popover-heading">筛选电脑</span>
                {(['all', ...hosts.map((host) => host.id)] as ('all' | HostId)[]).map((id) =>
                  <button key={id} onClick={() => { setHostFilter(id); setPopup(null); }}><Monitor size={16}/>{id === 'all' ? '全部电脑' : id}{hostFilter === id && <Check size={16} className="check-icon" />}</button>)}
              </div>}
            </div>
            <button className="task-row" onClick={() => { setReminderTarget(null); setView('tasks'); setPopup(null); closeOnMobile(); }}><Clock3 size={20} /><span>定时任务</span></button>
            <div className="section-header"><button className="section-toggle" aria-expanded={!collapsedSections.includes('pinned')}
              onClick={() => toggleSection('pinned')}>置顶<ChevronRight size={15} className={collapsedSections.includes('pinned') ? '' : 'chevron-open'}/></button></div>
            {!collapsedSections.includes('pinned') && <div className="pinned-section">
              {pinnedProjects.map((project) => projectRow(project))}
              {pinnedConversations.map((item) => conversationRow(item, false, 'pinned'))}
              {!pinnedProjects.length && !pinnedConversations.length &&
                <div className="empty-recents">点击项目或对话旁的图钉即可置顶</div>}
            </div>}
            <div className="section-header"><button className="section-toggle" aria-expanded={!collapsedSections.includes('projects')}
              onClick={() => toggleSection('projects')}>项目<ChevronRight size={15} className={collapsedSections.includes('projects') ? '' : 'chevron-open'}/></button>
              {!collapsedSections.includes('projects') && <button aria-label="新建项目" title="创建项目" onClick={() => { setProjectCreateOpen(true); setPopup(null); closeOnMobile(); }}><Plus size={21}/></button>}</div>
            {!collapsedSections.includes('projects') && <>
            {hosts.filter((host) => hostFilter === 'all' || host.id === hostFilter).map((host) => {
              const collapsed = hostCollapsed.includes(host.id);
              return <div className="host-tree" key={host.id}>
                <button className="tree-host" onClick={() => toggle(hostCollapsed, host.id, setHostCollapsed)} aria-expanded={!collapsed}>
                  <ChevronRight size={17} className={collapsed ? '' : 'chevron-open'} />
                  <Monitor size={19} /><strong>{host.displayName}</strong><span className={'host-demo-dot ' + live.status[host.id]} title={'连接状态：' + live.status[host.id]} />
                </button>
                {!collapsed && <div className="tree-projects">{projects.filter((p) => p.hostId === host.id).map(projectRow)}</div>}
              </div>;
            })}
            </>}
            <div className="section-header recent-header"><button className="section-toggle"
              aria-expanded={!collapsedSections.includes('recent')} onClick={() => toggleSection('recent')}>
              {showArchived ? '已归档对话' : '最近对话'}
              <ChevronRight size={15} className={collapsedSections.includes('recent') ? '' : 'chevron-open'}/></button>
              {!collapsedSections.includes('recent') && <button aria-label="刷新所有电脑的会话" title="刷新所有电脑的会话" disabled={sidebarRefreshing} onClick={() => { void refreshSidebar(); }}><RefreshCw size={17} className={sidebarRefreshing ? 'sidebar-refresh-spinner' : ''}/></button>}
              {!collapsedSections.includes('recent') && <button data-popup-trigger aria-label="最近对话设置" title="最近对话设置" onClick={() => setPopup(popup === 'recent' ? null : 'recent')}><Settings size={20} /></button>}
            </div>
            {!collapsedSections.includes('recent') && <>
            {popup === 'recent' && <div className="recent-settings">
              <label><input type="checkbox" checked={showAllRecent} onChange={(e) => setShowAllRecent(e.target.checked)} />显示项目中的对话</label>
              <label><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />查看归档对话</label>
            </div>}
            {recents.length === 0 && <div className="empty-recents">{Object.values(live.status).some((s) => s === 'connecting') ? '正在从电脑读取会话…' : '暂无真实会话'}</div>}
            {recents.slice(0, recentLimit).map((item) => conversationRow(item))}
            {sidebarRefreshing && recents.length > recentLimit && <div className="more-recents is-refreshing" role="status" aria-live="polite">
              <RefreshCw size={14} className="sidebar-refresh-spinner"/>正在刷新…</div>}
            {!sidebarRefreshing && recents.length > recentLimit && <button className="more-recents"
              onClick={() => setRecentLimit((count) => count + 10)}>加载更多对话<ChevronDown size={14}/></button>}
            </>}
          </div>
        </div>
        <div className="sidebar-footer">
          <button className="new-chat-button" aria-label="新建聊天" title="新建聊天" onClick={() => createNewChat()}><ComposeIcon size={20}/></button>
          <div className="quota-ring-group">
            <WebQuotaRing kind="fiveHour" label="5小时" quota={currentQuota}
              onClick={() => {
                setPopup(null); setQuotaDetail('fiveHour');
                void live.refreshQuotaGuard().catch(() => undefined);
                void live.refreshRateQuota(currentHost).catch(() => undefined);
              }} />
            <WebQuotaRing kind="weekly" label="每周" quota={currentQuota}
              onClick={() => {
                setPopup(null); setQuotaDetail('weekly');
                void live.refreshQuotaGuard().catch(() => undefined);
                void live.refreshRateQuota(currentHost).catch(() => undefined);
              }} />
          </div>
          <button data-popup-trigger className="profile-button" aria-label="设置" title="设置" onClick={() => setPopup(popup === 'account' ? null : 'account')}><span className="profile-mark">C</span></button>
          {popup === 'account' && <div className="popover account-popover"><span className="popover-heading">Codex 工作台</span>
          {typeof (window as Window & { ReactNativeWebView?: { postMessage: (value: string) => void } }).ReactNativeWebView?.postMessage === 'function' &&
            <button aria-label="更改手机内网入口"
              onClick={() => (window as Window & {
                ReactNativeWebView?: { postMessage: (value: string) => void }
              }).ReactNativeWebView?.postMessage('codexmobileui:configure')}>
                <Settings size={17}/>更改手机内网入口
            </button>}
            <button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setPopup(null); }}>{theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}切换至{theme === 'dark' ? '浅色' : '深色'}模式</button>
            <button onClick={() => { setSettingsProject(null); setSettingsOpen(true); setPopup(null); closeOnMobile(); }}><Settings size={17}/>电脑与设置</button>
          </div>}
        </div>
      </div>
      <div className="sidebar-resizer" role="separator" aria-label="调整侧栏宽度"
        aria-orientation="vertical" aria-valuemin={260} aria-valuemax={480}
        aria-valuenow={sidebarWidth} tabIndex={0}
        onPointerDown={beginSidebarResize} onPointerMove={moveSidebarResize}
        onPointerUp={endSidebarResize} onPointerCancel={endSidebarResize}
        onKeyDown={resizeSidebarWithKeyboard}/>
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
          {view === 'chat' && active && !active.attachedToThreadId && <button type="button" className="top-icon side-chat-trigger"
            title="旁路对话" aria-label="旁路对话" aria-expanded={sidePanelOpen}
            onMouseDown={(e) => { if (window.getSelection()?.toString().trim()) e.preventDefault(); }}
            onClick={openSideChat}><PanelRightOpen size={20}/></button>}
          {view === 'chat' && <button data-popup-trigger className="top-icon top-more" aria-label="对话菜单" title="对话菜单" onClick={() => setPopup(popup === 'options' ? null : 'options')}><Ellipsis size={22}/></button>}
          {popup === 'options' && <div className="popover options-popover">
            <span className="popover-heading">当前会话</span>
            {active ? <>
              {renaming ? <form className="rename-inline" onSubmit={(event) => { event.preventDefault(); saveRename(); }}>
                <input aria-label="新聊天标题" autoFocus maxLength={80} value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)} />
                <button type="submit" disabled={editingThread}>完成</button>
              </form> : <button onClick={() => { setRenameDraft(active.title); setRenaming(true); }}><Pencil size={16}/>重命名</button>}
              <button onClick={() => actionForCurrent('copy')}><Copy size={16}/>复制对话 ID</button>
              <button disabled={editingThread || !!forkingThread || !latestForkableTurnId(active)}
                onClick={() => actionForCurrent('fork')}>
                <GitBranch size={16} className={forkingThread === conversationKey(active.hostId, active.id)
                  ? 'control-spin' : undefined}/>
                {forkingThread === conversationKey(active.hostId, active.id) ? '正在创建分支' : '从最近回复创建分支'}
              </button>
              <button onClick={() => actionForCurrent('pin')}><Pin size={16}/>{pinnedIds.includes(conversationKey(active.hostId,active.id)) ? '取消置顶' : '置顶'}</button>
              <button disabled={editingThread} onClick={() => actionForCurrent('archive')}><Archive size={16}/>{active.archived ? '取消归档' : '归档'}</button>
              <button disabled={editingThread} className="danger-action" onClick={() => actionForCurrent('delete')}><Trash2 size={16}/>删除</button>
            </> : <button onClick={() => { setPopup(null); }}><ComposeIcon size={16}/>尚无当前会话</button>}
          </div>}
        </div>
      </header>

      {view === 'tasks' ? <AutomationView
          key={reminderTarget ? reminderTarget.navigation : 'tasks'}
          hosts={hosts.map((host) => host.id)}
          initialHost={reminderTarget?.hostId ?? currentHost}
          initialReminder={reminderTarget ?? undefined}
          projects={projects}
          models={live.models}
          status={live.status}
          request={live.request}
          onOpenThread={(targetHost, threadId) => {
            void live.refresh(targetHost).then(() => live.select(targetHost, threadId))
              .then(() => {
                setActiveId(conversationKey(targetHost, threadId));
                setNewHost(targetHost);
                setView('chat');
                closeOnMobile();
              }).catch(() => setNotice('无法打开任务对话，请刷新列表后重试'));
          }}
          onNewChat={() => createNewChat()}/> :
        <div className={'chat-region' + (active ? ' has-conversation' : ' is-landing')}>
          {active ? <div className="message-viewport" key={active.hostId + active.id}>
            {chatFind?.key === conversationKey(active.hostId, active.id) && <div className="chat-find-bar">
              <Search size={17}/>
              <input autoFocus aria-label="查找当前对话内的消息" placeholder="查找此聊天中的文字"
                value={chatFind.query} onChange={(event) =>
                  setChatFind((old) => old ? { ...old, query: event.target.value, current: -1 } : old)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); advanceChatFind(event.shiftKey ? -1 : 1); }
                  if (event.key === 'Escape') { event.stopPropagation(); setChatFind(null); }
                }}/>
              <span>{chatFind.query.trim() ? chatFindMatches.length + ' 条' : '输入关键词'}</span>
              <button title="上一个结果" disabled={!chatFindMatches.length}
                onClick={() => advanceChatFind(-1)}><ArrowUp size={16}/></button>
              <button title="下一个结果" disabled={!chatFindMatches.length}
                onClick={() => advanceChatFind(1)}><ArrowDown size={16}/></button>
              <button title="关闭当前对话查找" onClick={() => setChatFind(null)}><X size={17}/></button>
            </div>}
            <div className="chat-context"><span><Monitor size={13}/>{active.hostId}</span>{active.project && <span><Folder size={13}/>{getProjectName(active.project, active.hostId)}</span>}<button className="context-refresh" onClick={() => void live.refresh(active.hostId).then(() => live.select(active.hostId, active.id)).then((messages) => {
              setOptimisticSubmissions((old) => reconcileOptimisticAfterRead(
                old, 'thread:' + conversationKey(active.hostId, active.id), messages));
            }).catch(() => setNotice('刷新失败，请检查连接'))}>刷新真实记录</button></div>
            <div className="message-scroller" ref={scrollerRef} onScroll={onMessageScroll}>
              <div className="messages-wrap" ref={contentRef}>
            {active.messages.map((message, index) => {
              if (message.activityType === 'subAgentActivity' && message.agentThreadId) {
                const group = subAgentRows.get(message.agentThreadId);
                if (!group || group.first.id !== message.id) return null;
                return <article key={group.childId} className="message message-assistant message-subagent-activity"
                  data-context-kind="message" data-message-index={index} data-context-host={active.hostId}
                  data-context-id={message.id}>
                  <SubAgentActivityFeed hostId={active.hostId} parentId={active.id} group={group}
                    online={live.status[active.hostId] === 'online'} readActivity={live.readSubAgentActivity}
                    readHistory={live.readSubAgent} onActivityChange={live.reportAgentActivity}/>
                </article>;
              }
              const turn = message.turnId ? turnActions.get(message.turnId) : undefined;
              const endOfTurn = Boolean(turn && turn.lastIndex === index);
              const answerText = endOfTurn ? turn?.answerText ?? '' : '';
              const terminal = Boolean(turn?.terminal) &&
                !(isRunning && active.activeTurnId === message.turnId);
              const isTool = message.kind === 'tool';
              const logo = findToolLogo(toolLogos[active.hostId] ?? [], message.pluginId, message.appId);
              return <Fragment key={message.id}>
                {optimisticPositions.get(index)?.map(renderOptimisticSubmission)}
                <article data-context-kind="message" data-message-index={index}
                data-context-host={active.hostId} data-context-id={message.id}
                className={'message message-' + message.role +
                  (chatFind?.key === conversationKey(active.hostId, active.id) &&
                    chatFind.current >= 0 && chatFindMatches[chatFind.current] === index ? ' chat-find-highlight' : '') +
                  (isTool ? ' message-command-activity' : '')}>
              {message.role === 'user' ? <div className="user-bubble">
                {message.content && <div>{message.content}</div>}
                {message.files?.map((file) => <button className="chat-file-tile context-press-target"
                  data-context-kind="file" data-context-host={active.hostId} data-context-id={file.path}
                  data-context-origin="user"
                  key={file.itemId + ':' + file.fileIndex}
                  title={desktopBridge() ? '在资源管理器中定位' : '复制文件绝对路径'}
                  onClick={() => desktopBridge() ? void revealHostFile(active.hostId, file.path) :
                    void copyToClipboard(file.path).then(() => setNotice('路径已复制'))
                      .catch(() => setNotice('无法复制路径'))}>
                  <FileText size={19}/>
                  <span className="chat-file-path">{file.path}</span>
                  <span className="chat-file-name">{file.name}</span>
                  <Copy size={14}/>
                </button>)}
                {message.images?.length ? <div className="message-image-grid">
                  {message.images.map(({ itemId, imageIndex }) =>
                    <MessageImage key={itemId + ':' + imageIndex}
                      hostId={active.hostId} threadId={active.id} itemId={itemId}
                      imageIndex={imageIndex} readImage={live.readImage} onOpen={setImageViewer}/>)}
                </div> : null}
              </div> :
                message.kind === 'turnError' ? <div className={'turn-error' + (message.failed ? ' activity-failed' : '')}
                  role={message.failed ? 'alert' : 'status'}>
                  <span>{message.failed ? '本轮失败' : '正在重连'}</span>
                  {message.content !== '正在重连' && <p>{message.content}</p>}
                  {message.detail && <details><summary>错误详情</summary><pre>{message.detail}</pre></details>}
                </div> :
                message.kind === 'reasoning' ? <ReasoningActivity message={message}/> :
                message.kind ? <details className={'activity-card native-activity' + (isTool ? ' native-command' : '') + (message.failed ? ' activity-failed' : '')}>
                  <summary>{message.complete ? <Check size={16}/> : <span className="activity-spinner"/>}
                    {isTool ? <>
                      {message.activityType === 'imageView' ? <Image size={15}/> :
                        ['mcpToolCall', 'dynamicToolCall'].includes(message.activityType ?? '')
                          ? <ToolBrandIcon logo={logo}/> : null}
                      <span className="command-label" title={message.content}>
                        {toolDisplayName(message.activityType, message.title, message.content,
                          message.toolServer, message.toolName)}
                      </span>
                    </>
                      : <span className="activity-label">{message.title ?? '工具调用'}</span>}
                    {message.failed && <span className="activity-error">失败</span>}<ChevronDown size={15}/></summary>
                    {(message.content || message.detail) && <div className="activity-native-body">
                    {message.content && (!isTool || !message.detail &&
                      message.activityType !== 'imageView') && (message.kind === 'plan'
                      ? <MessageMarkdown text={message.content}/> : <p>{message.content}</p>)}
                    {message.detail && <pre>{message.detail}</pre>}
                    {message.activityType === 'imageView' && message.turnId &&
                      <ToolImage hostId={active.hostId} threadId={active.id} turnId={message.turnId}
                        itemId={message.id.slice(message.id.indexOf(':') + 1)}
                        readToolImage={live.readToolImage}
                        onOpen={setImageViewer}/>}
                  </div>}
                </details> :
                <div className="assistant-response"><MessageMarkdown text={message.content}
                  hostId={active.hostId} threadId={active.id}
                  itemId={message.id.slice(message.id.indexOf(':') + 1)}
                  readAssistantImage={live.readAssistantImage} onOpenImage={setImageViewer}
                  onOpenFile={(path, linkIndex) => openAssistantFile(
                    path, linkIndex, message.id.slice(message.id.indexOf(':') + 1))}
                  onRevealFile={desktopBridge() ? (path) => { void revealHostFile(active.hostId, path); } : undefined}
                  displayPath={(path) => pathForViewer(path, active.hostId, viewerHost, pathHosts)}
                  imageReady={message.complete !== false}
                  onCopyPath={(path) => void copyToClipboard(path).then(() => setNotice('路径已复制'))
                    .catch(() => setNotice('无法复制路径'))}/>{message.activity && <details className="activity-card">
                  <summary><FileText size={16}/>{message.activity.title}<ChevronDown size={15}/></summary>
                  <div className="activity-lines">{message.activity.lines.map((line) => <div key={line}><Check size={13}/>{line}</div>)}</div>
                </details>}</div>}
              {message.role === 'user' && message.timestampMs && <div className="message-tools message-tools-user">
                <span>{new Date(message.timestampMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>}
              {endOfTurn && terminal && answerText && <div className="message-tools turn-actions">
                <button title="复制本轮助手回复" aria-label="复制助手回复" onClick={() => {
                  void copyToClipboard(answerText).then(() => setNotice('消息已复制'))
                    .catch(() => setNotice('浏览器不允许访问剪贴板'));
                }}><Copy size={16}/></button>
                <button title="从此轮助手回复创建分支" aria-label="从此轮助手回复创建分支"
                  disabled={!!forkingThread}
                  onClick={() => message.turnId && forkFromTurn(active, message.turnId)}>
                  <GitBranch size={16} className={forkingThread === conversationKey(active.hostId, active.id)
                    ? 'control-spin' : undefined}/>
                </button>
                {message.timestampMs && <span>{new Date(message.timestampMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>}
                </article>
              </Fragment>;
            })}
            {optimisticPositions.get(active.messages.length)?.map(renderOptimisticSubmission)}
            {isRunning && <ThinkingIndicator key={active.activeTurnId} startedAt={active.runningSinceMs}/>}
            </div></div>
            {showJump && <button className="jump-to-latest" type="button"
              title="跳转到最新消息" aria-label="跳转到最新消息" onClick={jumpToLatest}>
              <ArrowDown size={20} aria-hidden="true"/>
            </button>}
          </div> : visibleLocalSubmissions.length > 0
             ? <div className="messages-wrap pending-first-message">{visibleLocalSubmissions.map(renderOptimisticSubmission)}</div>
             : <div className="landing-heading">
               <h1>{landingProjectName ? <>在 <span className="landing-project-name">{landingProjectName}</span> 中开始新对话</>
                 : '有什么可以帮忙的？'}</h1>
               <p>{landingProjectName ? currentHost : <>在 {currentHost} 上开始新的 Codex 会话</>}</p>
             </div>}
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
              {mentionOpen && activeMention && <div className="mention-popover" role="listbox"
                aria-label="Skills、Apps 和 Plugins">
                {mentionGroups.map((group) => <div className="mention-group" role="group"
                  aria-label={group.label} key={group.kind}>
                  <div className="mention-heading">{group.label}</div>
                  {group.options.map(({ item, index }) => <button type="button" role="option"
                  aria-selected={index === Math.min(mentionIndex, mentionOptions.length - 1)}
                  className={'mention-option' + (index === Math.min(mentionIndex, mentionOptions.length - 1) ? ' selected' : '')}
                  key={item.kind + item.path} onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseMention(item)}>
                  <MentionIcon item={item}/>
                  <span className="mention-detail"><strong>{item.label}</strong>
                    {item.description && <small>{item.description}</small>}</span>
                  {item.kind === 'plugin' && !!item.skillCount &&
                    <span className="mention-skill-count">{item.skillCount} Skills</span>}
                </button>)}</div>)}
                {!mentionOptions.length && <div className="mention-empty">
                  {mentionRefreshing && !mentionItems.length ? '正在读取可用引用…' :
                    mentionItems.length ? '无匹配结果' : '暂无可用引用'}</div>}
              </div>}
              {(plan || pastedImages.length > 0 || pastedDocuments.length > 0) && <div className="attachment-list">
                {plan && <button className="attachment-chip" onClick={() => setPlan(false)}><ListTodo size={14}/>计划模式 <X size={13}/></button>}
                {pastedImages.map((entry) => <div key={entry.id} className="pasted-image">
                  <button type="button" onClick={() => openPastedImageViewer(entry)} title="查看待发送图片">
                    <img src={entry.url} alt="待发送图片"/>
                  </button>
                  <button type="button" className="pasted-image-remove" aria-label="移除图片" disabled={submitting}
                    onClick={() => removeImage(entry.id)}><X size={14}/></button>
                </div>)}
                {pastedDocuments.map((entry) => <div className="attachment-chip document-attachment" key={entry.id}>
                  <FileText size={15}/><span title={entry.file.name}>{entry.file.name}</span>
                  <button type="button" aria-label={`移除文件 ${entry.file.name}`}
                    disabled={submitting} onClick={() => removeDocument(entry.id)}><X size={14}/></button>
                </div>)}
              </div>}
              <textarea ref={composeRef} rows={2} enterKeyHint={phoneComposer() ? 'enter' : undefined} aria-label="消息输入框" value={draft}
                placeholder="询问任何问题，也可以 Ctrl+V 粘贴图片"
                onPaste={handlePaste}
                onChange={(e) => updateMentionDraft(e.target.value, e.target.selectionStart)}
                onClick={(e) => {
                  const caret = e.currentTarget.selectionStart;
                  setMentionCaret(caret);
                  setMentionOpen(!!mentionQuery(draft, caret));
                }} onKeyDown={handleEnter}/>
              {hasDraftAttachments && !readyAttachments && <div className="image-upload-progress" role="status">
                {!connected ? '等待连接目标电脑' : preparingFailed ? '附件上传失败' :
                  '正在上传附件 · ' + (preparingProgress ?? 0) + '%'}
                {connected && preparingFailed && <button type="button" className="cancel-upload"
                  onClick={() => setRetryUpload((value) => value + 1)}>重试上传</button>}
              </div>}
              {submitting && uploadProgress !== null && <div className="image-upload-progress" role="status">
                {uploadPhase === 'uploading' ? '正在上传附件 · ' + uploadProgress + '%' : '附件已上传，等待服务器确认'}
                <div className="image-upload-track"><span style={{ width: uploadProgress + '%' }}/></div>
                {uploadPhase === 'uploading' && <button type="button" className="cancel-upload"
                  onClick={() => uploadController.current?.abort()}>取消上传</button>}
              </div>}
              <div className="composer-actions">
                <div className="composer-actions-left">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" multiple hidden disabled={attachmentsDisabled} onChange={handleFiles}/>
                  <input ref={documentRef} type="file" accept=".txt,.md,.json,.jsonl,.csv,.log,.yaml,.yml,.xml,.js,.jsx,.ts,.tsx,.py,.html,.css,.sh,.ps1,.java,.kt,.rs,.go,.c,.cpp,.h,.pdf,.docx,.xlsx,.pptx,.zip"
                    multiple hidden disabled={attachmentsDisabled} onChange={handleDocuments}/>
                  <button data-popup-trigger className="composer-tool" title="添加内容" aria-label="添加内容" onClick={() => setPopup(popup === 'add' ? null : 'add')}><Plus size={23}/></button>
                  <button data-popup-trigger className="composer-tool" title="选择权限" aria-label={nextPermission ? "选择权限，下一轮生效" : "选择权限"} onClick={() => setPopup(popup === 'permission' ? null : 'permission')}><CurrentPermissionIcon size={22} color={selectedPermission === 'full-access' ? '#ce922f' : undefined}/></button>
                  <button data-popup-trigger className="model-selector" title="模型与思考强度" onClick={() => setPopup(popup === 'model' ? null : 'model')}>
                    <span className="model-selector-text">{selectedModel?.name ?? '选择模型'} · {effortLabels[effectiveEffort] ?? '默认'}</span>
                    <ChevronDown size={14}/>
                  </button>
                </div>
                <div className="composer-actions-right">
                  <button data-popup-trigger className="composer-host-selector" onClick={() => setPopup(popup === 'project' ? null : 'project')} title="选择电脑或项目"><Monitor size={14}/>{currentHost}<ChevronDown size={13}/></button>
                  {active && <button type="button"
                    data-popup-trigger="context" className="context-usage-button"
                    aria-label={contextPercent === null ? '上下文窗口，查看详情' : '上下文窗口占用 ' + contextPercent + '%，查看详情'}
                    aria-expanded={popup === 'context'}
                    title={contextUsage && contextPercent !== null ? '上下文占用 ' + contextPercent + '% · ' +
                      formatContextTokens(contextUsage.usedTokens) + ' / ' + formatContextTokens(contextUsage.windowTokens) + ' Token' : '上下文窗口'}
                    onClick={() => setPopup(popup === 'context' ? null : 'context')}>
                    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".27" strokeWidth="3"/>
                      <circle cx="12" cy="12" r="9" fill="none" stroke="#75a9ec" strokeWidth="3"
                        strokeLinecap="round" strokeDasharray={2 * Math.PI * 9}
                        strokeDashoffset={2 * Math.PI * 9 * (1 - (contextPercent ?? 0) / 100)}
                        transform="rotate(-90 12 12)"/>
                    </svg>
                    <span className="context-usage-percent">{contextPercent === null ? '—' : contextPercent + '%'}</span>
                  </button>}
                  {popup === 'context' && active && <div
                    className="popover context-usage-popover" role="group" aria-label="上下文窗口详情">
                    <strong>上下文窗口</strong>
                    {contextUsage && contextPercent !== null ? <>
                      <div>已使用 {formatContextTokens(contextUsage.usedTokens)} / {formatContextTokens(contextUsage.windowTokens)} Token</div>
                      <div>占用 {contextPercent}% · 剩余 {100 - contextPercent}%</div>
                      <div className="context-usage-progress"><span style={{ width: contextPercent + '%' }}/></div>
                    </> : <div>服务器暂未返回占用数据</div>}
                    <div className="popover-divider"/>
                    <button type="button" className="context-compact-action"
                      disabled={!active || !connected || submitting || stopping || pendingPermission !== null ||
                        compactPhase !== 'unknown' && !active.messages.length ||
                        compactPhase !== 'unknown' && (isRunning || compacting || activeQueue.length > 0 || goalWorking)}
                      onClick={() => { if (!active) return;
                        void (compactPhase === 'unknown' ? live.recheckCompaction(active.hostId, active.id)
                          : live.compactThread(active.hostId, active.id)).catch(() => setNotice('压缩操作未完成，请查看上下文窗口状态'));
                      }}>
                      {compactPhase === 'starting' || compactPhase === 'working' ? <span className="activity-spinner"/> : <Minimize2 size={16}/>}
                      {compactPhase === 'starting' || compactPhase === 'working' ? '正在压缩上下文' : compactPhase === 'unknown' ? '检查压缩结果' : '压缩上下文'}
                    </button>
                    {compactPhase === 'completed' && <small>上下文已压缩</small>}
                    {compactPhase === 'failed' && <small>压缩失败，可手动重试</small>}
                    {compactPhase === 'unknown' && <small>压缩结果未确认，先检查记录</small>}
                    {compactPhase === 'unconfirmed' && <small>结果未确认，当前空闲，可手动重试</small>}
                    {!compacting && (isRunning || activeQueue.length > 0) && <small>任务执行或排队时不能压缩</small>}
                    {!active.messages.length && <small>暂无可压缩的历史记录</small>}
                  </div>}
                  <button className={'send-button' + (stopMode ? ' stop-mode' : '')}
                    disabled={composerBusy || (stopMode ? !active?.activeTurnId : !canSend || (hasDraftAttachments && (attachmentsDisabled || !readyAttachments))) || live.status[currentHost] !== 'online'}
                    aria-label={composerBusy ? '等待服务器确认' : stopMode ? '停止当前轮次' : '发送消息'}
                    title={stopMode ? '停止当前轮次' : '发送到 ' + currentHost} onClick={send}>
                    {composerBusy ? <span className="send-spinner"/> : stopMode ? <Square size={16} fill="currentColor"/> : <ArrowUp size={21}/>}
                  </button>
                </div>
              </div>
              {popup === 'add' && <div ref={addMenuRef} className="popover composer-popover add-popover"><span className="popover-heading">{attachmentsDisabled ? "排队模式只支持文本" : "添加到消息"}</span>
                <button disabled={attachmentsDisabled} onClick={() => { fileRef.current?.click(); setPopup(null); }}><Image size={18}/>照片</button>
                <button disabled={attachmentsDisabled} onClick={() => { documentRef.current?.click(); setPopup(null); }}><FileText size={18}/>上传文件</button>
                <button onClick={() => { setPlan(!plan); setPopup(null); }}><ListTodo size={18}/>{plan ? '退出计划模式' : '计划模式'}</button>
                <button onClick={() => { setGoalDraft(displayedGoal); setGoalEditor(true); setPopup(null); }}><Target size={18}/>目标</button>
              </div>}
              {popup === 'permission' && <div className="popover composer-popover permission-popover"><span className="popover-heading">{nextPermission && followUpMode === "queue"
                ? "服务器排队消息沿用当前权限" : "审批权限"}</span>
                {permissionKey && live.customPermissionChanged[permissionKey] && <p className="popover-footnote">上次选择：自定义；当前原生权限已变化。</p>}
                {(['default','auto-review','read-only','full-access','custom'] as PermissionMode[]).map((mode) => {
                  const PermissionIcon = permissionIcons[mode];
                  return <button key={mode} disabled={submitting || pendingPermission !== null} onClick={() => selectPermission(mode)}>
                    <PermissionIcon size={17} color={mode === 'full-access' ? '#ce922f' : undefined}/>{permissionLabels[mode]}
                    {nextPermission === mode && <small>下一轮生效</small>}
                    {pendingPermission === mode ? <span className="activity-spinner check-icon"/>
                      : selectedPermission === mode && <Check className="check-icon" size={16}/>}
                  </button>;
                })}
              </div>}
              {popup === 'model' && <div className="popover composer-popover model-popover"><span className="popover-heading">{currentHost} 的真实模型列表</span>
                {!availableModels.length && <span className="popover-heading">当前电脑暂未返回模型</span>}
                {availableModels.map((item) => <button key={item.id} disabled={modelChangePending} onClick={() => {
                  applyModelSelection(item.id, item.defaultEffort ?? item.efforts[0] ?? 'medium');
                }}><span>{item.name}</span>{selectedModel?.id === item.id && <Check className="check-icon" size={16}/>}</button>)}
                <div className="popover-divider"/>
                {availableEfforts.map((item) => <button key={item} disabled={modelChangePending} onClick={() => {
                  if (selectedModel) applyModelSelection(selectedModel.id, item); setPopup(null);
                }}>{effortLabels[item] ?? item}{effectiveEffort === item && <Check className="check-icon" size={16}/>}</button>)}
              </div>}
              {popup === 'project' && <div className="popover composer-popover target-popover"><span className="popover-heading">新聊天目标电脑 / 项目</span>
                {hosts.map((host) => <button key={host.id} onClick={() => { createNewChat(host.id); }}><Monitor size={17}/>{host.displayName}{!active && newHost === host.id && <Check className="check-icon" size={16}/>}</button>)}
                <div className="popover-divider"/>{projects.filter((p) => p.hostId === currentHost).map((p) =>
                  <button key={p.id} aria-pressed={!active && newProject === p.id} onClick={() => createNewChat(p.hostId, p.id)}>
                    <Folder size={16}/>{p.name}{!active && newProject === p.id && <Check className="check-icon" size={16}/>}
                  </button>)}
                <p className="popover-footnote">已有会话不可直接更换所属电脑。</p>
              </div>}
            </div>
          </div></div>
        </div>}
    </main>
    {sidePanelOpen && active && <SideChatPanel key={activeId} source={active} live={live} pathHosts={pathHosts}
      drafts={sideDrafts} setDraft={setSideDraft} initialSelection={sideInitialSelection}
      onClose={() => setSidePanelFor(null)}/>}

    {settingsOpen && <SettingsView key={settingsProject ? settingsProject.hostId + ':' + settingsProject.id : 'general'}
      browserNotifications={browserNotifications}
      pathHosts={pathHosts}
      onSavePathHosts={async (next) => {
        const saved = await savePathHosts(next);
        setPathHosts(saved);
        syncDesktopPathHosts(saved);
      }}
      viewerHost={viewerHost}
      viewerHostAuto={autoViewerHost !== null}
      onViewerHost={changeViewerHost}
      hosts={hosts.map((host) => host.id)}
      initialHost={settingsProject?.hostId ?? currentHost}
      initialProjectId={settingsProject?.id}
      projects={projects}
      theme={theme}
      onTheme={setTheme}
      followUpMode={followUpMode}
      onFollowUpMode={setFollowUpMode}
      request={live.request}
      onClose={() => { setSettingsOpen(false); setSettingsProject(null); }}/>}
    {projectCreateOpen && <ProjectCreateDialog
      hosts={hosts.map((host) => host.id)}
      initialHost={currentHost}
      request={live.request}
      refresh={live.refresh}
      onClose={() => setProjectCreateOpen(false)}/>}
    {searchOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="搜索所有聊天" className="search-dialog">
        <div className="search-input-row"><Search size={20}/><input ref={searchRef} value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} placeholder="搜索所有电脑的聊天标题和正文…"/><button aria-label="关闭搜索" onClick={() => setSearchOpen(false)}><X size={20}/></button></div>
        <div className="search-results">
          {!searchConnected && <p className="search-empty" role="status">服务器未连接</p>}
          {searchConnected && <>
            <span className="popover-heading">{searchTerm ? '搜索结果 · ' + searchResults.length : '最近对话'}</span>
            {disconnectedSearchHosts.length > 0 && <span className="popover-heading" role="status">{disconnectedSearchHosts.map(({ displayName }) => displayName).join('、')} 服务器未连接</span>}
            {threadSearch.pending && <p className="search-empty" role="status">搜索中</p>}
            {!threadSearch.pending && threadSearch.error && <p className="search-empty" role="status">{threadSearch.error}</p>}
            {!threadSearch.pending && !threadSearch.error && searchResults.length === 0 &&
              <p className="search-empty" role="status">{searchTerm ? '没有匹配的对话' : '没有最近对话'}</p>}
          </>}
          {searchResults.map(({ conversation: item, snippet }) => <button className="search-result"
            key={conversationKey(item.hostId,item.id)} onClick={() => chooseConversation(item.hostId, item.id, item)}>
            <FileText size={19}/><span><strong>{item.title}</strong>{snippet && <small>{snippet}</small>}<small>{item.hostId} · {getProjectName(item.project, item.hostId) ?? '无项目'} · {dateLabel(item.updatedAt)}</small></span><ChevronRight size={17}/>
          </button>)}
          {threadSearch.hasMore && <button className="search-result" disabled={threadSearch.pending} onClick={threadSearch.loadMore}>加载更多</button>}
        </div><div className="search-shortcut">Ctrl / ⌘ + K 搜索 <span>ESC 关闭</span></div>
      </div>
    </div>}

    {imageViewer && <div className="image-viewer image-viewer-preview" role="dialog" aria-modal="true"
      aria-label="查看图片原图" {...imageLongPress}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setImageSaveMenu(null);
          setImageViewer(null);
        }
      }}>
      <button className="image-viewer-close" onClick={() => {
        setImageSaveMenu(null);
        setImageViewer(null);
      }} aria-label="关闭图片查看"><X size={22}/></button>
      <ImageViewerSaveActions source={imageViewer} menuPoint={imageSaveMenu}
        onCloseMenu={() => setImageSaveMenu(null)}/>
      <ImageZoomSurface src={imageViewer.url} alt="原图"/>
    </div>}
    {contextMenu && <div className="context-menu-layer" onPointerDown={(e) => e.stopPropagation()}>
      <button className="context-menu-dismiss" aria-label="关闭操作菜单"
        onClick={() => setContextMenu(null)}/>
      <div className="context-menu-panel" role="menu" aria-label="条目操作"
        style={{ left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 280)),
          top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 440)) }}>
        {contextThread && contextMenu.page === 'projects' ? <>
          <button className="context-menu-back" onClick={() =>
            setContextMenu((old) => old ? { ...old, page: 'main' } : old)}>
            <ChevronRight className="context-menu-back-arrow" size={16}/>返回对话操作
          </button>
          <div className="context-menu-caption">移动到项目 · {contextThread.hostId}</div>
          {contextOption('不属于任何项目', FolderOpen, () => {
            void modifyThread(contextThread, 'move', '');
          }, !contextThread.project)}
          {projects.filter((project) => project.hostId === contextThread.hostId).map((project) =>
            <button role="menuitem" key={project.id} disabled={contextBusy || contextThread.project === project.id}
              onClick={() => { setContextMenu(null); void modifyThread(contextThread, 'move', project.id); }}>
              <Folder size={16}/><span>{project.name}</span>
              {contextThread.project === project.id && <Check size={15} className="context-menu-check"/>}
            </button>)}
        </> : contextThread ? <>
          <div className="context-menu-caption">{contextThread.title}</div>
          {contextOption('重命名', Pencil, () =>
            beginContextRename({ kind: 'thread', hostId: contextThread.hostId,
              id: contextThread.id, original: contextThread.title }))}
          {contextOption(pinnedIds.includes(conversationKey(contextThread.hostId, contextThread.id)) ?
            '取消置顶' : '置顶', Pin, () => void changePin({
            type: 'thread', hostId: contextThread.hostId, id: contextThread.id,
          }, !pinnedIds.includes(conversationKey(contextThread.hostId, contextThread.id))))}
          {contextOption(unreadThreads[conversationKey(contextThread.hostId, contextThread.id)] ?
            '标为已读' : '标为未读', unreadThreads[conversationKey(contextThread.hostId, contextThread.id)] ?
              Eye : EyeOff, () => markUnread(contextThread.hostId, contextThread.id,
                !unreadThreads[conversationKey(contextThread.hostId, contextThread.id)]))}
          <button role="menuitem" disabled={contextBusy}
            onClick={() => setContextMenu((old) => old ? { ...old, page: 'projects' } : old)}>
            <FolderInput size={16}/><span>移动到项目</span><ChevronRight size={16} className="context-menu-check"/>
          </button>
          {contextOption('在聊天中查找', Search, () => {
            openChatFind(contextThread.hostId, contextThread.id);
          })}
          <div className="context-menu-separator"/>
          {contextOption('分享', Share2, () =>
            void shareThread(contextThread.hostId, contextThread.id, contextThread.title))}
          {contextOption('复制链接', Link2, () => copyContextText(
            threadLink(window.location.origin + window.location.pathname,
              contextThread.hostId, contextThread.id), '会话链接'))}
          {contextOption('复制对话 ID', Copy, () => copyContextText(contextThread.id, '对话 ID'))}
          {contextOption(forkingThread === conversationKey(contextThread.hostId, contextThread.id)
            ? '正在从最近回复创建分支' : '从最近回复创建分支', GitBranch, () => {
            const turnId = latestForkableTurnId(contextThread);
            if (turnId) forkFromTurn(contextThread, turnId);
          }, !!forkingThread || !latestForkableTurnId(contextThread))}
          {contextOption('复制工作目录', FolderOpen, () => {
            const project = projects.find((p) =>
              p.hostId === contextThread.hostId && p.id === contextThread.project);
            const cwd = contextThread.cwd || project?.roots[0];
            if (cwd) copyContextText(cwd, '工作目录');
          }, !contextThread.cwd && !projects.some((p) => p.hostId === contextThread.hostId &&
            p.id === contextThread.project && p.roots.length > 0))}
          <div className="context-menu-separator"/>
          {contextOption(contextThread.archived ? '取消归档' : '归档', Archive,
            () => void modifyThread(contextThread, 'archive'))}
          {contextOption('删除对话', Trash2, () => void modifyThread(contextThread, 'delete'),
            false, true)}
        </> : contextProject ? <>
          <div className="context-menu-caption">{contextProject.name}</div>
          {contextOption('新建项目聊天', SquarePen, () =>
            createNewChat(contextProject.hostId, contextProject.id))}
          {contextOption(pinnedProjectIds.includes(conversationKey(contextProject.hostId, contextProject.id)) ?
            '取消置顶' : '置顶项目', Pin, () => void changePin({
              type: 'project', hostId: contextProject.hostId, id: contextProject.id,
            }, !pinnedProjectIds.includes(conversationKey(contextProject.hostId, contextProject.id))))}
          {contextOption('重命名项目', Pencil, () =>
            beginContextRename({ kind: 'project', hostId: contextProject.hostId,
              id: contextProject.id, original: contextProject.name }))}
          {contextOption('项目规则', FileText, () => {
            setSettingsProject({ hostId: contextProject.hostId, id: contextProject.id });
            setSettingsOpen(true); closeOnMobile();
          }, !contextProject.roots.length)}
          {contextOption('复制工作目录', FolderOpen, () =>
            copyContextText(contextProject.roots[0], '工作目录'), !contextProject.roots.length)}
          <div className="context-menu-separator"/>
          {contextOption('删除项目', Trash2, () => void deleteProject(contextProject), false, true)}
        </> : contextMenu.kind === 'file' ? <>
          <div className="context-menu-caption">文件操作</div>
          {contextOption('复制文件路径', Copy, () => copyContextText(
            pathForViewer(contextMenu.id, contextMenu.hostId, viewerHost, pathHosts), '文件路径'))}
          {desktopBridge() ? contextOption('在资源管理器中定位', FolderOpen,
            () => void revealHostFile(contextMenu.hostId, contextMenu.id)) :
            contextMenu.origin === 'assistant' && contextOption('打开文件预览', ArrowDown,
              () => openAssistantFile(contextMenu.id, contextMenu.linkIndex ?? 0, contextMenu.itemId),
              contextMenu.linkIndex === undefined || !contextMenu.itemId)}
        </> : contextMenu.kind === 'image' ? <>
          <div className="context-menu-caption">图片操作</div>
          {contextOption('查看原图', Image, () => void openContextImageViewer(contextMenu.id))}
          {contextOption('复制图片', Copy, () => void copyContextImage(contextMenu.id))}
        </> : contextMessage ? <>
          <div className="context-menu-caption">消息操作</div>
          {contextOption('复制这条消息', Copy, () => copyContextText(contextMessage.content, '消息'),
            !contextMessage.content)}
          {contextMessage.role === 'user' && contextOption('复制到输入框', Pencil, () => {
            const key = active ? 'thread:' + conversationKey(active.hostId, active.id) : '';
            if (key) setDrafts((old) => ({ ...old, [key]: contextMessage.content }));
            composeRef.current?.focus();
          }, !contextMessage.content)}
        </> : <span className="context-menu-caption">条目不可用，请刷新列表</span>}
      </div>
    </div>}
    {renameTarget && <div className="modal-backdrop context-rename-backdrop">
      <form className="context-rename-dialog" onSubmit={(event) => {
        event.preventDefault(); void saveContextRename();
      }}>
        <strong>{renameTarget.kind === 'thread' ? '重命名对话' : '重命名项目'}</strong>
        <input autoFocus value={renameValue} maxLength={80} disabled={contextBusy}
          onChange={(event) => setRenameValue(event.target.value)}/>
        <div><button type="button" disabled={contextBusy} onClick={() => setRenameTarget(null)}>取消</button>
          <button type="submit" disabled={contextBusy}>保存</button></div>
      </form>
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

    {publicationTarget && <PublicationPreview target={publicationTarget}
      request={live.request} onClose={() => setPublicationTarget(null)}
      onRevealFile={desktopBridge() ? revealPublicationFile : undefined}
      onCopyLink={(url) => copyToClipboard(url)}/>}
    {notice && <div className="toast" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15}/></button></div>}
    {quotaDetail && <div className="quota-dialog-layer">
      <button className="quota-dialog-dismiss" aria-label="关闭额度详情" onClick={() => setQuotaDetail(null)}/>
      <div className="quota-dialog" role="dialog" aria-label="额度详情">
        <div className="quota-dialog-heading">{quotaDetail === 'fiveHour' ? '5 小时额度' : '每周额度'}</div>
        <div className="quota-dialog-amount">{quotaPercent(currentQuota, quotaDetail) === null
          ? '剩余 —' : '剩余 ' + quotaPercent(currentQuota, quotaDetail) + '%'}</div>
        <div className="quota-dialog-note">{quotaResetLabel(currentQuota, quotaDetail)}</div>
        {currentQuota && <div className="quota-dialog-note">
          更新于 {new Date(currentQuota.updatedAt).toLocaleTimeString()}
        </div>}
        <div className="quota-guard" data-state={quotaGuardState?.status ?? 'loading'}>
          <div className="quota-guard-heading">
            <ShieldCheck size={16}/>
            <span>额度保护</span>
          </div>
          <label className="quota-guard-toggle">
            <input type="checkbox" checked={quotaGuardState?.enabled === true}
              disabled={!quotaGuardEditable || (!quotaGuardState?.enabled && quotaGuardHasAdditionalPeers)}
              onChange={event => {
                if (quotaGuardState) void saveQuotaGuardSettings(event.currentTarget.checked, quotaGuardState.thresholdPercent);
              }} />
            <span className="quota-guard-switch" aria-hidden="true"/>
            <span>{quotaGuardWorking ? '正在保存…' : '启用自动保护'}</span>
          </label>
          {quotaGuardState && <form key={quotaGuardState.revision} className="quota-guard-threshold"
            onSubmit={event => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get('threshold');
              if (typeof value === 'string' && value !== '' && Number(value) !== quotaGuardState.thresholdPercent) {
                void saveQuotaGuardSettings(quotaGuardState.enabled, Number(value));
              }
            }}>
            <label>剩余额度阈值 <input name="threshold" type="number" min={0} max={100} step={1} required
              defaultValue={quotaGuardState.thresholdPercent} disabled={!quotaThresholdEditable}/> %</label>
            <button type="submit" disabled={!quotaThresholdEditable}>保存</button>
          </form>}
          <div className="quota-guard-note">
            任一额度窗口剩余量达到或低于已保存的阈值时触发。触发后阻止新回合、引导、队列、目标和定时任务；读取与手动停止不受影响。
          </div>
          {quotaGuardHasAdditionalPeers &&
            <div className="quota-guard-note">共享额度保护仍限于 6v / noha；保护开启时新主机的模型工作会被拦截。</div>}
          <div className="quota-guard-status" role="status">
            <strong>{quotaGuardStatusLabel(quotaGuardState?.status)}</strong>
            {quotaGuardState?.triggerReason && <span>{quotaGuardState.triggerReason}</span>}
            {quotaGuardState?.sync.state === 'pending' &&
              <span>{quotaGuardState.sync.reason ?? '另一台电脑尚未确认共享设置，新工作会等待同步。'}</span>}
          </div>
          {quotaGuardState && <div className="quota-guard-hosts">
            {(['6v', 'noha'] as const).map((hostId) => {
              const host = quotaGuardState.hosts[hostId];
              return <span key={hostId} data-status={host?.status ?? 'pending'}>
                {hostId} · {quotaGuardStatusLabel(host?.status)}
              </span>;
            })}
          </div>}
        </div>
      </div>
    </div>}
    <button className="mobile-menu" aria-label="展开侧边栏" onClick={() => setSidebarOpen(true)}><Menu size={21}/></button>
    <button className="mobile-new-chat" aria-label="新建聊天" onClick={() => createNewChat()}><SquarePen size={20}/></button>
  </div></>;
}
