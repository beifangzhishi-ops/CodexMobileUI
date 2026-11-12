import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AppState, BackHandler, KeyboardAvoidingView, Linking, Platform, Pressable,
  StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { OAuthLogin } from './src/auth/Login';
import { clearTokens, hasTokens } from './src/auth/tokens';
import { parseHost, type Host } from './src/core/host';
import { useCodexSession } from './src/session/useCodexSession';
import { loadDraft, loadHosts, removeHost, storeDraft, storeHost } from './src/storage/database';
import { isolatedHostCacheKey } from './src/storage/profile';
import { AccountScreen, FullRulesEditor } from './src/ui/AccountScreen';
import { ChatSidebar } from './src/ui/ChatSidebar';
import { ReferenceIcon } from './src/ui/ReferenceIcons';
import { ChatView } from './src/ui/ChatView';
import { ConversationMenu, type ConversationMenuAction } from './src/ui/ConversationMenu';
import { defaultUiPreferences, loadUiPreferences, persistUiPreferences, type UiPreferences } from './src/ui/preferences';
import type { ChatConversation, ChatProject } from './src/ui/chatModels';
import type { TurnSettings } from './src/session/firstSend';
import { DiagnosticsPanel } from './src/diagnostics/DiagnosticsPanel';
import { logDiagnostic } from './src/diagnostics/journal';
import { classifyDiagnosticError } from './src/diagnostics/safe';
import { useVisualTokens } from './src/ui/visual-tokens';

type Screen = 'chat' | 'account' | 'connect' | 'rules' | 'tasks';

function MainApp() {
  const visual = useVisualTokens();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [currentHost, setCurrentHost] = useState<Host | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [hostLoaded, setHostLoaded] = useState(false);
  const [preferences, setPreferences] = useState<UiPreferences>(defaultUiPreferences);
  const [preferencesLoadedFor, setPreferencesLoadedFor] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [screen, setScreen] = useState<Screen>('chat');
  const [rulesProjectId, setRulesProjectId] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [hostEntry, setHostEntry] = useState('');
  const [draft, setDraft] = useState('');
  const [draftReadyFor, setDraftReadyFor] = useState<string | null>(null);
  const generation = useRef(0);
  const hostId = currentHost?.id ?? null;
  const session = useCodexSession(authorized ? currentHost : null);
  const selectedId = session.draftKey ?? '';
  const workingKey = hostId && selectedId ? isolatedHostCacheKey(hostId) + ':' + selectedId : null;

  const reportError = useCallback((title: string, error: unknown) => {
    Alert.alert(title, error instanceof Error ? error.message : '电脑没有确认此操作，请核对连接状态');
  }, []);

  useEffect(() => {
    logDiagnostic('app.started', { platform: Platform.OS, appState: AppState.currentState });
    const subscription = AppState.addEventListener('change',
      (state) => logDiagnostic('app.stateChanged', { appState: state }));
    const deepLink = Linking.addEventListener('url', ({ url }) => {
      logDiagnostic('app.deepLinkReceived', { schemeMatched: url.startsWith('codexmobileui://') });
    });
    void Linking.getInitialURL().then((url) => logDiagnostic('app.initialLinkChecked', {
      codePresent: Boolean(url),
      schemeMatched: Boolean(url?.startsWith('codexmobileui://')),
    })).catch((error: unknown) => logDiagnostic('app.initialLinkFailed', classifyDiagnosticError(error)));
    void loadHosts().then((list) => {
      setHosts(list);
      if (list[0]) setCurrentHost(list[0]);
      else setScreen('account');
    }).catch((error: unknown) => reportError('读取电脑列表失败', error))
      .finally(() => setHostLoaded(true));
    return () => {
      subscription.remove(); deepLink.remove(); logDiagnostic('app.unmounted');
    };
  }, [reportError]);

  useEffect(() => {
    let active = true;
    setAuthorized(false);
    if (currentHost) void hasTokens(currentHost).then((ready) => {
      if (active) setAuthorized(ready);
    }).catch((error: unknown) => { if (active) reportError('授权状态检查失败', error); });
    return () => { active = false; };
  }, [hostId, reportError]);

  useEffect(() => {
    const next = ++generation.current;
    setPreferences(defaultUiPreferences());
    setPreferencesLoadedFor(null);
    if (hostId) void loadUiPreferences(hostId).then((value) => {
      if (next === generation.current) {
        setPreferences(value); setPreferencesLoadedFor(hostId);
      }
    }).catch((error: unknown) => reportError('界面偏好读取失败', error));
  }, [hostId, reportError]);

  useEffect(() => {
    if (hostId && preferencesLoadedFor === hostId) {
      void persistUiPreferences(hostId, preferences)
        .catch((error: unknown) => reportError('界面偏好保存失败', error));
    }
  }, [hostId, preferencesLoadedFor, preferences, reportError]);

  useEffect(() => {
    let active = true;
    setDraftReadyFor(null); setDraft('');
    if (hostId && selectedId && workingKey) {
      void loadDraft(isolatedHostCacheKey(hostId), selectedId).then((text) => {
        if (active) { setDraft(text); setDraftReadyFor(workingKey); }
      }).catch((error: unknown) => { if (active) reportError('草稿读取失败', error); });
    }
    return () => { active = false; };
  }, [workingKey, hostId, selectedId, reportError]);

  useEffect(() => {
    if (authorized && session.status === 'online' && !session.pending &&
      !session.activeThreadId && session.threads.length === 0) {
      void session.createThread(null, null).catch((error: unknown) =>
        reportError('新建会话失败', error));
    }
  }, [authorized, session.status, session.pending, session.activeThreadId,
    session.threads.length, session.createThread, reportError]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (diagnosticsOpen) { setDiagnosticsOpen(false); return true; }
      if (sidebar) { setSidebar(false); return true; }
      if (screen === 'rules') {
        setScreen(rulesProjectId ? 'chat' : 'account'); setRulesProjectId(null); return true;
      }
      if (screen === 'connect') { setScreen('account'); return true; }
      if (screen !== 'chat') { setScreen('chat'); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [sidebar, screen, diagnosticsOpen, rulesProjectId]);

  const projects = useMemo<ChatProject[]>(() => session.projects.map((project) => ({
    ...project, pinned: preferences.pinnedProjects.includes(project.id),
    rules: preferences.projectRules[project.id] ?? '',
    updatedAt: -(project.position ?? 0),
  })), [session.projects, preferences.pinnedProjects, preferences.projectRules]);

  const conversations = useMemo<ChatConversation[]>(() => {
    const threads = [
      ...session.threads.map((thread) => ({ ...thread, archived: false })),
      ...session.archivedThreads.map((thread) => ({ ...thread, archived: true })),
    ];
    const list = threads.map((thread): ChatConversation => ({
      id: thread.id, title: thread.name ?? '未命名会话', persisted: true,
      draft: selectedId === thread.id ? draft : '',
      messages: session.activeThreadId === thread.id ? session.messages : [],
      projectId: thread.projectId ?? null, hostId,
      archived: thread.archived, updatedAt: thread.updatedAt,
      pinned: preferences.pinnedThreads.includes(thread.id),
      running: session.activeThreadId === thread.id && session.running,
      unread: session.activeThreadId !== thread.id &&
        thread.updatedAt > (preferences.lastRead[thread.id] ?? thread.updatedAt),
    }));
    if (session.pending && session.draftKey) list.unshift({
      id: session.draftKey, title: '新聊天', persisted: false,
      draft, messages: [], projectId: session.pending.projectId,
      hostId, archived: false, updatedAt: Date.now() / 1000,
      pinned: false, running: false, unread: false,
    });
    return list;
  }, [session.threads, session.archivedThreads, session.activeThreadId, session.pending,
    session.draftKey, session.messages, session.running, preferences.pinnedThreads,
    preferences.lastRead, selectedId, draft, hostId]);

  const conversation: ChatConversation = conversations.find((item) => item.id === selectedId) ?? {
    id: '', title: '新聊天', persisted: false, draft: '', messages: [],
    projectId: null, hostId, archived: false, updatedAt: 0,
    pinned: false, running: false, unread: false,
  };
  const activeProject = projects.find((project) => project.id === conversation.projectId);
  const editingProject = projects.find((project) => project.id === rulesProjectId);

  const chooseConversation = (id: string) => {
    setScreen('chat'); setSidebar(false); setChatSearchOpen(false);
    if (id === session.draftKey) return;
    const thread = session.threads.find((item) => item.id === id);
    if (thread) setPreferences((old) => ({
      ...old, lastRead: { ...old.lastRead, [id]: thread.updatedAt },
    }));
    void session.chooseThread(id).catch((error: unknown) =>
      reportError('打开对话失败', error));
  };

  const newConversation = (projectId?: string) => {
    setScreen('chat'); setSidebar(false); setChatSearchOpen(false);
    if (!currentHost) { setScreen('connect'); return; }
    if (!authorized) return;
    const project = projects.find((item) => item.id === projectId);
    if (projectId && !project) { Alert.alert('项目不存在', '请刷新项目列表'); return; }
    // Projects without configured roots use the Gateway's host-owned
    // workspace preparation on first send, not a client-supplied filesystem path.
    const prepare = (cwd: string | null) => void session.createThread(project?.id ?? null, cwd)
      .catch((error: unknown) => reportError('新建会话失败', error));
    if (project && project.roots.length > 1) {
      Alert.alert('选择工作目录', project.name, [
        ...project.roots.slice(0, 6).map((cwd) => ({ text: cwd, onPress: () => prepare(cwd) })),
        { text: '取消', style: 'cancel' },
      ]);
    } else prepare(project?.roots[0] ?? null);
  };

  const updateDraft = (text: string) => {
    if (!hostId || !selectedId || draftReadyFor !== workingKey) return;
    setDraft(text);
    void storeDraft(isolatedHostCacheKey(hostId), selectedId, text)
      .catch((error: unknown) => reportError('草稿保存失败', error));
  };
  const send = (settings: TurnSettings) => {
    if (!currentHost || !authorized || session.status !== 'online') {
      Alert.alert('尚未连接', '请先连接并授权电脑端 Codex Gateway'); return;
    }
    if (!selectedId || !draft.trim() || draftReadyFor !== workingKey || conversation.running) return;
    const expected = selectedId;
    void session.send(draft.trim(), expected, settings).then(async () => {
      setDraft('');
      await storeDraft(isolatedHostCacheKey(currentHost.id), expected, '');
    }).catch((error: unknown) => reportError('发送状态不明确，勿重复发送', error));
  };
  const chooseHost = (id: string | null) => {
    if (!id) { setScreen('connect'); return; }
    const host = hosts.find((item) => item.id === id);
    if (host) {
      if (currentHost?.id === host.id) session.reconnectNow();
      else setCurrentHost(host);
      setScreen('chat');
    }
  };
  const chooseProject = (id: string | null) => {
    if (!currentHost || !authorized) return;
    if (conversation.persisted) {
      void session.moveThread(conversation.id, id)
        .catch((error: unknown) => reportError('切换项目失败', error));
      return;
    }
    if (draft.trim()) {
      Alert.alert('请先处理草稿', '发送或清空当前草稿后再更换项目'); return;
    }
    newConversation(id ?? undefined);
  };

  const threadAction = (id: string, action: 'rename' | 'pin' | 'delete' | 'archive' | 'move-out',
    value?: string) => {
    if (!id || id.startsWith('pending:')) return;
    if (action === 'pin') {
      setPreferences((old) => ({ ...old, pinnedThreads: old.pinnedThreads.includes(id)
        ? old.pinnedThreads.filter((item) => item !== id) : [...old.pinnedThreads, id] }));
      return;
    }
    const execute = async () => {
      if (action === 'rename') await session.renameThread(id, value ?? '');
      else if (action === 'move-out') await session.moveThread(id, null);
      else if (action === 'archive') await session.archiveThread(id,
        !session.archivedThreads.some((item) => item.id === id));
      else if (action === 'delete') await session.deleteThread(id);
    };
    if (action === 'delete') Alert.alert('删除真实会话', '删除后无法在电脑端恢复。确定删除？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => {
        void execute().catch((error: unknown) => reportError('删除失败', error));
      } },
    ]);
    else void execute().catch((error: unknown) => reportError('会话操作失败', error));
  };

  const projectAction = (id: string, action: 'rename' | 'pin' | 'delete', value?: string) => {
    if (action === 'pin') {
      setPreferences((old) => ({ ...old, pinnedProjects: old.pinnedProjects.includes(id)
        ? old.pinnedProjects.filter((item) => item !== id) : [...old.pinnedProjects, id] }));
      return;
    }
    const execute = () => action === 'rename'
      ? session.renameProject(id, value ?? '') : session.deleteProject(id);
    if (action === 'delete') Alert.alert('删除真实项目', '此操作会从电脑端删除项目。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => {
        void execute().catch((error: unknown) => reportError('删除项目失败', error));
      } },
    ]);
    else void execute().catch((error: unknown) => reportError('更改项目失败', error));
  };

  const conversationAction = (action: ConversationMenuAction) => {
    const id = conversation.id;
    if (!id || !conversation.persisted) return;
    if (action === 'copy-id') void Clipboard.setStringAsync(id)
      .then(() => Alert.alert('真实会话 ID 已复制'))
      .catch(() => Alert.alert('复制失败', '系统剪贴板不可用'));
    else if (action === 'find') setChatSearchOpen(true);
    else if (action === 'pin') threadAction(id, 'pin');
    else if (action === 'move-out') threadAction(id, 'move-out');
    else if (action === 'archive') threadAction(id, 'archive');
    else if (action === 'delete') threadAction(id, 'delete');
  };
  const addHost = async () => {
    try {
      const host = parseHost(hostEntry);
      await storeHost(host);
      setHosts((list) => list.some((item) => item.id === host.id) ? list : [...list, host]);
      setCurrentHost(host); setHostEntry(''); setScreen('chat');
    } catch (error) { reportError('电脑地址无效', error); }
  };
  const openRules = (id: string | null) => {
    setRulesProjectId(id); setScreen('rules'); setSidebar(false);
  };
  const title = screen === 'chat' ? (activeProject?.name ?? 'CodexMobile')
    : screen === 'account' ? '电脑与全局规则'
      : screen === 'connect' ? '连接新的电脑'
        : screen === 'tasks' ? '定时任务'
          : rulesProjectId ? (editingProject?.name ?? '项目') + ' · 项目规则' : '全局规则';

  return <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
    <StatusBar barStyle="light-content" />
    <KeyboardAvoidingView style={styles.keyboardLayout} behavior="padding">
      <View style={[styles.header, { height: visual.headerHeight }]}>
        <Pressable accessibilityRole="button"
          accessibilityLabel={screen === 'chat' ? '打开左上角菜单' : '返回'}
          style={[styles.headerButton, screen === 'chat' && styles.headerCircle]}
          onPress={() => {
            if (screen === 'chat') setSidebar(true);
            else if (screen === 'rules') {
              setScreen(rulesProjectId ? 'chat' : 'account'); setRulesProjectId(null);
            } else if (screen === 'connect') setScreen('account');
            else setScreen('chat');
          }}>
          {screen === 'chat' ? <ReferenceIcon name="menu" size={26} color="#fff" />
            : <ReferenceIcon name="chevron-left" size={24} color="#fff" />}
        </Pressable>
        <Text style={styles.heading} numberOfLines={1}>{title}</Text>
        {screen === 'account' ? <Pressable accessibilityRole="button" accessibilityLabel="诊断日志"
          onPressIn={() => logDiagnostic('diagnostics.headerPressIn')}
          onPress={() => { logDiagnostic('diagnostics.headerPressed'); setDiagnosticsOpen(true); }}
          style={styles.headerButton}><Text style={styles.logLabel}>日志</Text></Pressable>
          : screen === 'chat' && conversation.persisted
            ? <Pressable accessibilityRole="button" accessibilityLabel="对话更多操作"
                onPress={() => setConversationMenuOpen(true)}
                style={[styles.headerButton, styles.headerCircle]}>
                <ReferenceIcon name="ellipsis" size={24} color="#fff" />
              </Pressable> : <View style={styles.headerButton} />}
      </View>
      {screen === 'chat' && (!currentHost || !authorized ? <View style={styles.content}>
        {!hostLoaded ? <Text style={styles.emptyText}>正在读取电脑列表</Text>
          : currentHost ? <OAuthLogin host={currentHost} onConnected={() => setAuthorized(true)} />
            : <View style={styles.emptyScreen}>
              <Text style={styles.emptyTitle}>连接 Codex 电脑</Text>
              <Text style={styles.emptyText}>通过 HTTPS Gateway 授权后才能发送真实消息。</Text>
              <Pressable onPress={() => setScreen('connect')}>
                <Text style={styles.logLabel}>添加电脑</Text>
              </Pressable>
            </View>}
      </View> : <>
        {session.error ? <Text style={styles.emptyText}>{session.error}</Text> : null}
        <ChatView visual={visual} conversation={conversation}
          searchOpen={chatSearchOpen} onSearchClose={() => setChatSearchOpen(false)}
          hosts={hosts} projects={projects} hostId={hostId}
          onChooseHost={chooseHost} onChooseProject={chooseProject}
          onAddHost={() => setScreen('connect')}
          onDraft={updateDraft} onSend={send}
          online={session.status === 'online' && draftReadyFor === workingKey}
          availableModels={session.models} />
      </>)}
      {screen === 'account' && <AccountScreen hosts={hosts} selectedHostId={hostId}
        globalRules={preferences.globalRules} onSelectHost={chooseHost}
        onRenameHost={(id, name) => {
          const host = hosts.find((item) => item.id === id);
          if (!host) return;
          const next = { ...host, name: name.trim() || host.name };
          void storeHost(next).then(() => {
            setHosts((old) => old.map((item) => item.id === id ? next : item));
            if (hostId === id) setCurrentHost(next);
          }).catch((error: unknown) => reportError('重命名失败', error));
        }}
        onRemoveHost={(id) => {
          Alert.alert('移除电脑', '从本机移除连接信息，不关闭电脑上的 Codex。', [
            { text: '取消', style: 'cancel' },
            { text: '移除', style: 'destructive', onPress: () => {
              void removeHost(id).then(() => {
                const remaining = hosts.filter((item) => item.id !== id);
                setHosts(remaining);
                if (hostId === id) setCurrentHost(remaining[0] ?? null);
                const old = hosts.find((item) => item.id === id);
                if (old) void clearTokens(old).catch(() => undefined);
              }).catch((error: unknown) => reportError('移除失败', error));
            } },
          ]);
        }} onConnect={() => setScreen('connect')}
        onRulesChange={(text) => setPreferences((old) => ({ ...old, globalRules: text }))}
        onExpandRules={() => openRules(null)} />}
      {screen === 'connect' && <View style={styles.emptyScreen}>
        <Text style={styles.emptyTitle}>连接真实 Codex Gateway</Text>
        <Text style={styles.emptyText}>输入电脑 HTTPS Funnel 根地址，包含端口 8443。</Text>
        <TextInput accessibilityLabel="电脑 HTTPS Gateway 地址" value={hostEntry}
          onChangeText={setHostEntry} autoCapitalize="none" autoCorrect={false}
          placeholder="https://your-host.ts.net:8443" placeholderTextColor="#888"
          style={{ color: '#fff', backgroundColor: '#303030', borderRadius: 14,
            width: '100%', minHeight: 52, paddingHorizontal: 15 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="添加并连接电脑"
          onPress={() => { void addHost(); }}><Text style={styles.logLabel}>添加并连接</Text></Pressable>
        <Text style={styles.emptyText}>添加后通过手机浏览器完成 OAuth 授权。</Text>
      </View>}
      {screen === 'rules' && <FullRulesEditor
        title={rulesProjectId ? '项目规则（本地备注）' : '全局规则（本地备注）'}
        text={rulesProjectId ? (preferences.projectRules[rulesProjectId] ?? '') : preferences.globalRules}
        onChange={(text) => setPreferences((old) => rulesProjectId
          ? { ...old, projectRules: { ...old.projectRules, [rulesProjectId]: text } }
          : { ...old, globalRules: text })}
        onDone={() => { setScreen(rulesProjectId ? 'chat' : 'account'); setRulesProjectId(null); }} />}
      {screen === 'tasks' && <View style={styles.emptyScreen}>
        <Text style={styles.emptyTitle}>定时任务</Text>
        <Text style={styles.emptyText}>当前独立 Codex Gateway 尚未开放定时任务接口。</Text>
      </View>}
    </KeyboardAvoidingView>
    <ChatSidebar visual={visual} visible={sidebar} selectedId={selectedId}
      selectedHostId={hostId} conversations={conversations} projects={projects}
      includeProjectConversations={preferences.includeProjectConversations}
      onIncludeProjectConversations={(value) => setPreferences((old) =>
        ({ ...old, includeProjectConversations: value }))}
      onClose={() => setSidebar(false)} onNew={newConversation} onChoose={chooseConversation}
      onAccount={() => { setSidebar(false); setScreen('account'); }}
      onTasks={() => { setSidebar(false); setScreen('tasks'); }}
      onProjectCreate={(name) => void session.createProject(name)
        .catch((error: unknown) => reportError('创建真实项目失败', error))}
      onProjectAction={projectAction} onProjectRules={(id) => openRules(id)}
      onConversationAction={threadAction} />
    <ConversationMenu visible={conversationMenuOpen && screen === 'chat'}
      hasProject={Boolean(activeProject)} pinned={conversation.pinned}
      archived={conversation.archived} onClose={() => setConversationMenuOpen(false)}
      onAction={conversationAction} />
    <DiagnosticsPanel visible={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
  </SafeAreaView>;
}


class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { crashed: boolean; diagnosticsOpen: boolean }
> {
  state = { crashed: false, diagnosticsOpen: false };
  static getDerivedStateFromError(): { crashed: boolean } { return { crashed: true }; }
  componentDidCatch(error: Error): void {
    logDiagnostic('app.reactRenderFailed', classifyDiagnosticError(error));
  }
  render() {
    if (!this.state.crashed) return this.props.children;
    return <View style={styles.emptyScreen}>
      <Text style={styles.emptyTitle}>界面出现异常，请导出诊断日志排查</Text>
      <Pressable onPress={() => {
        logDiagnostic('diagnostics.crashScreenPressed');
        this.setState({ diagnosticsOpen: true });
      }}><Text style={styles.logLabel}>导出诊断日志</Text></Pressable>
      <DiagnosticsPanel visible={this.state.diagnosticsOpen}
        onClose={() => this.setState({ diagnosticsOpen: false })} />
    </View>;
  }
}

export default function App() {
  return <SafeAreaProvider><AppErrorBoundary><MainApp /></AppErrorBoundary></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  keyboardLayout: { flex: 1 },
  header: { height: 56, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#000' },
  headerButton: { width: 51, height: 50, alignItems: 'center', justifyContent: 'center' },
  headerCircle: { borderRadius: 26, backgroundColor: '#303030', borderWidth: 1, borderColor: '#454545' },
  heading: { flex: 1, textAlign: 'center', color: '#f5f5f5', fontSize: 17, fontWeight: '600' },
  logLabel: { color: '#eee', fontSize: 14, fontWeight: '600' },
  content: { flex: 1, backgroundColor: '#000' },
  emptyScreen: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 20 },
  emptyTitle: { color: '#eee', fontSize: 20, fontWeight: '600' },
  emptyText: { color: '#999', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  emptyIcon: { color: '#a4a4a4', fontSize: 42 },
});
