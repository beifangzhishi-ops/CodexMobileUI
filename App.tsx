import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  Alert, AppState, BackHandler, KeyboardAvoidingView, Platform, Pressable,
  StatusBar, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { demoReducer, initialDemoState } from './src/demo/conversations';
import { loadVisualState, persistVisualState } from './src/demo/persistence';
import { AccountScreen, FullRulesEditor } from './src/ui/AccountScreen';
import { ChatSidebar, NewChatIcon } from './src/ui/ChatSidebar';
import { DemoChat } from './src/ui/DemoChat';
import { DiagnosticsPanel } from './src/diagnostics/DiagnosticsPanel';
import { logDiagnostic } from './src/diagnostics/journal';
import { classifyDiagnosticError } from './src/diagnostics/safe';
import { useVisualTokens } from './src/ui/visual-tokens';

type Screen = 'chat' | 'account' | 'connect' | 'rules' | 'tasks';

const CONNECTION_TEST_HTML = `<!doctype html><html lang="zh">
<head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>body{background:#111;color:#eee;font-family:system-ui;padding:28px;margin:0}
.card{background:#292929;border-radius:22px;padding:24px;margin-top:34px}
h2{margin-top:0}button{background:#276be3;border:0;border-radius:13px;color:white;font-size:17px;
padding:15px 24px}p{line-height:1.7;color:#aaa}#result{color:#a8c7ff;font-weight:bold}</style></head>
<body><div class="card"><h2>连接新的电脑</h2>
<p>这是离线连接测试网页，不访问网络、不进行 OAuth，也不连接 Codex。</p>
<button onclick="document.getElementById('result').textContent='测试成功';
window.ReactNativeWebView.postMessage('add-demo-host')">测试连接</button>
<p id="result"></p></div></body></html>`;

function MainApp() {
  const visual = useVisualTokens();
  const [demo, dispatch] = useReducer(demoReducer, initialDemoState);
  const [loaded, setLoaded] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [screen, setScreen] = useState<Screen>('chat');
  const [rulesProjectId, setRulesProjectId] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const currentScreen = useRef({ selectedId: demo.selectedId, screen, sidebar });
  const createdDemoHost = useRef(false);
  currentScreen.current = { selectedId: demo.selectedId, screen, sidebar };
  const conversation = demo.conversations.find((c) => c.id === demo.selectedId) ?? demo.conversations[0];
  const editingProject = demo.projects.find((p) => p.id === rulesProjectId);

  useEffect(() => {
    logDiagnostic('app.started', { platform: Platform.OS, appState: AppState.currentState });
    const appSubscription = AppState.addEventListener('change', (state) => {
      logDiagnostic('app.stateChanged', { appState: state });
    });
    let alive = true;
    void loadVisualState().then((state) => {
      if (alive && state) dispatch({ type: 'hydrate', state });
    }).catch((error: unknown) => {
      logDiagnostic('app.initialLinkFailed', classifyDiagnosticError(error));
      if (alive) Alert.alert('本地记录读取失败', '将使用新的视觉演示数据。');
    }).finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; appSubscription.remove(); logDiagnostic('app.unmounted'); };
  }, []);

  useEffect(() => {
    if (loaded) void persistVisualState(demo).catch(() => {
      Alert.alert('本地保存失败', '请检查手机存储空间。');
    });
  }, [demo, loaded]);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (diagnosticsOpen) { setDiagnosticsOpen(false); return true; }
      if (sidebar) { setSidebar(false); return true; }
      if (screen === 'connect') { setScreen('account'); return true; }
      if (screen === 'rules') {
        setScreen(rulesProjectId ? 'chat' : 'account'); setRulesProjectId(null);
        return true;
      }
      if (screen !== 'chat') { setScreen('chat'); return true; }
      return false;
    });
    return () => listener.remove();
  }, [sidebar, screen, diagnosticsOpen, rulesProjectId]);

  const newConversation = (projectId?: string) => {
    dispatch({ type: 'new', projectId });
    setScreen('chat'); setSidebar(false);
  };
  const chooseConversation = (id: string) => {
    dispatch({ type: 'select', id });
    setScreen('chat'); setSidebar(false);
  };
  const sendMessage = () => {
    if (!conversation || !conversation.draft.trim() || conversation.running) return;
    const id = conversation.id;
    dispatch({ type: 'send' });
    // The delay exists only to make the running/unread UI observable in the demo.
    setTimeout(() => {
      const snapshot = currentScreen.current;
      dispatch({ type: 'reply', id, visible: snapshot.selectedId === id &&
        snapshot.screen === 'chat' && !snapshot.sidebar && AppState.currentState === 'active' });
    }, 650);
  };
  const openRules = (projectId: string | null) => {
    setSidebar(false); setRulesProjectId(projectId); setScreen('rules');
  };
  const connect = () => { createdDemoHost.current = false; setScreen('connect'); };
  const title = screen === 'chat' ? 'CodexMobile' : screen === 'account' ? '电脑与全局规则'
    : screen === 'connect' ? '连接新的电脑' : screen === 'tasks' ? '定时任务'
      : rulesProjectId ? `${editingProject?.name ?? '项目'} · 项目规则` : '全局规则';

  return <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
    <StatusBar barStyle="light-content" />
    <KeyboardAvoidingView style={styles.keyboardLayout} behavior="padding">
      <View style={[styles.header, { height: visual.headerHeight }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={screen === 'chat' ? '打开左上角菜单' : '返回'}
          style={styles.headerButton}
          onPress={() => {
            if (screen === 'chat') setSidebar(true);
            else if (screen === 'connect') setScreen('account');
            else if (screen === 'rules') {
              setScreen(rulesProjectId ? 'chat' : 'account'); setRulesProjectId(null);
            } else setScreen('chat');
          }}
        ><Text style={styles.headerSymbol}>{screen === 'chat' ? '☰' : '‹'}</Text></Pressable>
        <Text style={styles.heading} numberOfLines={1}>{title}</Text>
        {screen === 'account' ? <Pressable
          accessibilityRole="button"
          accessibilityLabel="诊断日志"
          onPressIn={() => logDiagnostic('diagnostics.headerPressIn')}
          onPress={() => {
            logDiagnostic('diagnostics.headerPressed'); setDiagnosticsOpen(true);
          }}
          style={styles.headerButton}
        ><Text style={styles.logLabel}>日志</Text></Pressable>
          : screen === 'chat' ? <Pressable accessibilityRole="button" accessibilityLabel="新建聊天"
              onPress={() => newConversation()} style={styles.headerButton}>
              <NewChatIcon size={visual.newChatIconSize} />
            </Pressable> : <View style={styles.headerButton} />}
      </View>
      {screen === 'chat' && <DemoChat
        visual={visual}
        conversation={conversation}
        onDraft={(text) => dispatch({ type: 'draft', text })}
        onSend={sendMessage}
      />}
      {screen === 'account' && <AccountScreen
        hosts={demo.hosts}
        selectedHostId={demo.selectedHostId}
        globalRules={demo.globalRules}
        onSelectHost={(id) => dispatch({ type: 'host-select', id })}
        onRenameHost={(id, name) => dispatch({ type: 'host-rename', id, name })}
        onRemoveHost={(id) => dispatch({ type: 'host-remove', id })}
        onConnect={connect}
        onRulesChange={(text) => dispatch({ type: 'global-rules', text })}
        onExpandRules={() => openRules(null)}
      />}
      {screen === 'connect' && <WebView
        accessibilityLabel="离线连接测试网页"
        source={{ html: CONNECTION_TEST_HTML }}
        originWhitelist={['about:blank']}
        javaScriptEnabled
        onMessage={(event) => {
          if (event.nativeEvent.data !== 'add-demo-host' || createdDemoHost.current) return;
          createdDemoHost.current = true;
          dispatch({ type: 'host-add', name: `演示电脑 ${demo.hosts.length + 1}` });
        }}
        style={styles.content}
      />}
      {screen === 'rules' && <FullRulesEditor
        title={rulesProjectId ? '项目规则' : '全局规则'}
        text={rulesProjectId ? (editingProject?.rules ?? '') : demo.globalRules}
        onChange={(text) => rulesProjectId
          ? dispatch({ type: 'project-rules', id: rulesProjectId, text })
          : dispatch({ type: 'global-rules', text })}
        onDone={() => { setScreen(rulesProjectId ? 'chat' : 'account'); setRulesProjectId(null); }}
      />}
      {screen === 'tasks' && <View style={styles.emptyScreen}>
        <Text style={styles.emptyIcon}>◷</Text>
        <Text style={styles.emptyTitle}>定时任务</Text>
        <Text style={styles.emptyText}>当前为视觉演示版本，尚未接入实际定时任务。</Text>
      </View>}
    </KeyboardAvoidingView>
    <ChatSidebar
      visual={visual}
      visible={sidebar}
      selectedId={demo.selectedId}
      selectedHostId={demo.selectedHostId}
      conversations={demo.conversations}
      projects={demo.projects}
      includeProjectConversations={demo.includeProjectConversations}
      onIncludeProjectConversations={(value) => dispatch({ type: 'include-project-conversations', value })}
      onClose={() => setSidebar(false)}
      onNew={newConversation}
      onChoose={chooseConversation}
      onAccount={() => { setSidebar(false); setScreen('account'); }}
      onTasks={() => { setSidebar(false); setScreen('tasks'); }}
      onProjectCreate={(name) => dispatch({ type: 'project-create', name })}
      onProjectAction={(id, action, value) => dispatch(action === 'pin'
        ? { type: 'project-pin', id } : action === 'delete'
          ? { type: 'project-delete', id } : { type: 'project-rename', id, name: value ?? '' })}
      onProjectRules={(id) => openRules(id)}
      onConversationAction={(id, action, value) => dispatch(action === 'pin'
        ? { type: 'conversation-pin', id } : action === 'delete'
          ? { type: 'conversation-delete', id } : { type: 'conversation-rename', id, title: value ?? '' })}
    />
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
  headerSymbol: { color: '#eee', fontSize: 27 },
  heading: { flex: 1, textAlign: 'center', color: '#f5f5f5', fontSize: 17, fontWeight: '600' },
  logLabel: { color: '#eee', fontSize: 14, fontWeight: '600' },
  content: { flex: 1, backgroundColor: '#000' },
  emptyScreen: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 20 },
  emptyTitle: { color: '#eee', fontSize: 20, fontWeight: '600' },
  emptyText: { color: '#999', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  emptyIcon: { color: '#a4a4a4', fontSize: 42 },
});
