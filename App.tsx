import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Linking, Modal, Platform, Pressable, StatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { OAuthLogin } from './src/auth/Login';
import { clearTokens, hasTokens } from './src/auth/tokens';
import { parseHost, type Host } from './src/core/host';
import { threadCategory, type CodexProject } from './src/core/projectApi';
import { useCodexSession } from './src/session/useCodexSession';
import { loadHosts, storeHost } from './src/storage/database';
import { ChatThread } from './src/ui/ChatThread';
import { DiagnosticsPanel } from './src/diagnostics/DiagnosticsPanel';
import { logDiagnostic } from './src/diagnostics/journal';
import { classifyDiagnosticError } from './src/diagnostics/safe';

function MainApp() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [currentHost, setCurrentHost] = useState<Host | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hostChooser, setHostChooser] = useState(false);
  const [threadChooser, setThreadChooser] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [hostEntry, setHostEntry] = useState('');
  const [projectFilter, setProjectFilter] = useState('all');
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [rootTarget, setRootTarget] = useState<CodexProject | null>(null);
  const session = useCodexSession(authorized ? currentHost : null);

  useEffect(() => {
    logDiagnostic('app.started', { platform: Platform.OS, appState: AppState.currentState });
    const appSubscription = AppState.addEventListener('change', (state) => {
      logDiagnostic('app.stateChanged', { appState: state });
    });
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      // OAuth URLs can contain code/state: never persist any portion of them.
      logDiagnostic('app.deepLinkReceived', {
        schemeMatched: url.startsWith('codexmobileui://'),
      });
    });
    void Linking.getInitialURL().then((url) => {
      logDiagnostic('app.initialLinkChecked', {
        codePresent: Boolean(url),
        schemeMatched: Boolean(url?.startsWith('codexmobileui://')),
      });
    }).catch((error: unknown) => {
      logDiagnostic('app.initialLinkFailed', classifyDiagnosticError(error));
    });
    return () => {
      appSubscription.remove();
      linkSubscription.remove();
      logDiagnostic('app.unmounted');
    };
  }, []);

  useEffect(() => {
    logDiagnostic('app.hostLoadStarted');
    void loadHosts().then((list) => {
      logDiagnostic('app.hostLoadFinished', { count: list.length });
      setHosts(list);
      if (list[0]) setCurrentHost(list[0]);
      else setHostChooser(true);
    }).catch((e: unknown) => Alert.alert('本地存储错误', e instanceof Error ? e.message : ''))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    let alive = true;
    setAuthorized(false);
    if (!currentHost) return;
    logDiagnostic('app.tokenCheckStarted');
    void hasTokens(currentHost).then((yes) => {
      logDiagnostic('app.tokenCheckFinished', { codePresent: yes });
      if (alive) setAuthorized(yes);
    }).catch((error: unknown) => {
      logDiagnostic('app.tokenCheckFailed', classifyDiagnosticError(error));
      if (alive) setAuthorized(false);
    });
    return () => { alive = false; };
  }, [currentHost?.id]);

  const addHost = useCallback(async () => {
    logDiagnostic('app.addHostPressed');
    try {
      const host = parseHost(hostEntry);
      await storeHost(host);
      logDiagnostic('app.hostAdded');
      setHosts((existing) => existing.some((h) => h.id === host.id) ? existing : [...existing, host]);
      setCurrentHost(host);
      setHostChooser(false);
      setHostEntry('');
      setProjectFilter('all');
    } catch (e) {
      logDiagnostic('app.addHostFailed', classifyDiagnosticError(e));
      Alert.alert('电脑地址无效', e instanceof Error ? e.message : '');
    }
  }, [hostEntry]);

  const projects = session.projects;
  const visible = session.threads.filter((thread) =>
    projectFilter === 'all' || threadCategory(thread) === projectFilter);
  const selected = session.threads.find((thread) => thread.id === session.activeThreadId);
  const projectName = projects.find((item) => item.id === session.pending?.projectId)?.name;
  const beginNew = () => {
    const target = projects.find((item) => item.id === projectFilter);
    if (projectFilter === 'all' || projectFilter === 'uncategorized') {
      Alert.alert('选择新会话归属', '请先选择具体项目，或直接创建无项目会话。', [
        { text: '取消' },
        { text: '无项目会话', onPress: () => {
          setProjectFilter('unassigned');
          void session.createThread(null, null).then(() => setThreadChooser(false))
            .catch((e: unknown) => Alert.alert('无法新建', String(e)));
        } },
      ]);
      return;
    }
    if (target && target.roots.length > 1) {
      setRootTarget(target);
      return;
    }
    if (target && target.roots.length === 0) {
      Alert.alert('无法新建', '该项目没有可用工作目录，请先在桌面端检查项目配置。');
      return;
    }
    void session.createThread(target?.id ?? null, target?.roots[0] ?? null)
      .then(() => setThreadChooser(false))
      .catch((e: unknown) => Alert.alert('无法新建', String(e)));
  };

  if (checking) return (
    <View style={styles.loading}>
      <ActivityIndicator color="#ade5d7" size="large" />
      <Pressable accessibilityRole="button" onPress={() => {
        logDiagnostic('diagnostics.loadingPressed');
        setDiagnosticsOpen(true);
      }}>
        <Text style={styles.headerActionText}>诊断日志</Text>
      </Pressable>
      <DiagnosticsPanel visible={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => setHostChooser(true)} style={styles.hostButton}>
          <Text style={styles.hostName} numberOfLines={1}>{currentHost?.name ?? '选择电脑'} ▾</Text>
          <View style={[styles.statusDot, session.status === 'online' && styles.online]} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="诊断日志"
          onPressIn={() => logDiagnostic('diagnostics.headerPressIn')}
          onPress={() => {
            logDiagnostic('diagnostics.headerPressed');
            setDiagnosticsOpen(true);
          }} style={styles.headerAction}>
          <Text style={styles.headerActionText}>日志</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setThreadChooser(true)} style={styles.headerAction}>
          <Text style={styles.headerActionText}>会话 ☰</Text>
        </Pressable>
      </View>
      <View style={styles.subheader}>
        <Text style={styles.threadTitle} numberOfLines={1}>
          {session.pending ? '新对话' : (selected?.name ?? (selected ? '未命名会话' : 'CodexMobileUI'))}
        </Text>
        <Text style={styles.cwd} numberOfLines={1}>
          {session.pending ? (session.pending.cwd ?? '无项目 · 独立工作区将在首次发送时创建') +
            (projectName ? ' · ' + projectName : '') :
            (selected?.cwd ?? (session.status === 'online' ? '选择或新建会话' : '离线 · 只读缓存 / 本地草稿'))}
        </Text>
      </View>
      {session.error ? <Text style={styles.error} numberOfLines={3}>{session.error}</Text> : null}
      {!currentHost ? (
        <View style={styles.center}><Text style={styles.empty}>请先添加一台电脑的 HTTPS Funnel 地址。</Text></View>
      ) : !authorized ? (
        <OAuthLogin host={currentHost} onConnected={() => setAuthorized(true)} />
      ) : session.draftKey ? (
        <ChatThread key={currentHost.id + ':' + session.draftKey} host={currentHost} session={session} />
      ) : (
        <View style={styles.center}>
          <Text style={styles.empty}>还没有会话，或尚未加载历史列表。</Text>
          <Pressable
            style={styles.primary}
            onPress={beginNew}
          ><Text style={styles.primaryText}>新建 Codex 会话</Text></Pressable>
        </View>
      )}

      <Modal visible={hostChooser} animationType="slide" transparent onRequestClose={() => setHostChooser(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>电脑连接</Text>
              <Pressable onPress={() => setHostChooser(false)}><Text style={styles.close}>完成</Text></Pressable>
            </View>
            {hosts.map((host) => (
              <Pressable key={host.id} style={styles.choice} onPress={() => {
                setCurrentHost(host); setProjectFilter('all'); setHostChooser(false);
              }}>
                <Text style={styles.choiceName}>{host.name}</Text>
                <Text style={styles.choiceHint} numberOfLines={1}>{host.baseUrl}</Text>
              </Pressable>
            ))}
            <Text style={styles.helper}>添加该电脑的受 OAuth 保护的 Funnel HTTPS 根地址</Text>
            <TextInput
              style={styles.field} autoCapitalize="none" autoCorrect={false}
              value={hostEntry} onChangeText={setHostEntry}
              placeholder="https://your-host.ts.net"
              placeholderTextColor="#7e8b9b"
            />
            <Pressable style={styles.primary} onPress={() => { void addHost(); }}>
              <Text style={styles.primaryText}>添加并连接</Text>
            </Pressable>
            {currentHost && authorized ? <Pressable onPress={() => {
              Alert.alert('重新授权', '这只会删除本机保存的令牌。', [
                { text: '取消' }, { text: '删除本机令牌', onPress: () => {
                  void clearTokens(currentHost).then(() => setAuthorized(false));
                  setHostChooser(false);
                } },
              ]);
            }}><Text style={styles.relogin}>重新授权当前电脑</Text></Pressable> : null}
          </View>
        </View>
      </Modal>

      <Modal visible={threadChooser} animationType="slide" transparent onRequestClose={() => setThreadChooser(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>项目与会话</Text>
              <Pressable onPress={() => setThreadChooser(false)}><Text style={styles.close}>完成</Text></Pressable>
            </View>
            <View style={styles.projectScroll}>
              <Pressable onPress={() => setProjectFilter('all')} style={[styles.projectChip, projectFilter === 'all' && styles.activeChip]}>
                <Text style={styles.chipText}>全部</Text>
              </Pressable>
              <Pressable onPress={() => setProjectFilter('unassigned')}
                style={[styles.projectChip, projectFilter === 'unassigned' && styles.activeChip]}>
                <Text style={styles.chipText}>无项目</Text>
              </Pressable>
              {projects.map((item) => (
                <Pressable key={item.id} style={[styles.projectChip, projectFilter === item.id && styles.activeChip]}
                  onPress={() => setProjectFilter(item.id)}>
                  <Text style={styles.chipText} numberOfLines={1}>{item.name}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setProjectFilter('uncategorized')}
                style={[styles.projectChip, projectFilter === 'uncategorized' && styles.activeChip]}>
                <Text style={styles.chipText}>未分类</Text>
              </Pressable>
            </View>
            <FlatList
              style={styles.threadList}
              data={visible}
              keyExtractor={(thread) => thread.id}
              ListEmptyComponent={<Text style={styles.helper}>暂无已记录的会话</Text>}
              renderItem={({ item }) => (
                <View style={styles.choice}>
                  <Pressable onPress={() => {
                    void session.chooseThread(item.id);
                    setThreadChooser(false);
                  }}>
                    <Text style={styles.choiceName} numberOfLines={1}>{item.name ?? '未命名会话'}</Text>
                    <Text style={styles.choiceHint} numberOfLines={1}>
                      {item.cwd ?? '无项目'} · {item.id.slice(0, 10)}
                    </Text>
                  </Pressable>
                  <View style={styles.projectScroll}>
                    <Pressable onPress={() => setMoveTarget(item.id)} style={styles.projectChip}>
                      <Text style={styles.chipText}>移动到项目</Text>
                    </Pressable>
                    <Pressable onPress={() => {
                      setRenameTarget(item.id);
                      setRenameValue(item.name ?? '');
                    }} style={styles.projectChip}>
                      <Text style={styles.chipText}>重命名</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            />
            <Pressable
              style={[styles.primary, session.status !== 'online' && styles.disabled]}
              onPress={beginNew}
            ><Text style={styles.primaryText}>＋ 新建会话</Text></Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={moveTarget !== null} animationType="slide" transparent
        onRequestClose={() => setMoveTarget(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>移动会话到项目</Text>
              <Pressable onPress={() => setMoveTarget(null)}><Text style={styles.close}>取消</Text></Pressable>
            </View>
            <Text style={styles.helper}>仅更新 Codex 项目归属；原工作目录和文件不会移动。</Text>
            <FlatList style={styles.threadList} data={projects} keyExtractor={(item) => item.id}
              renderItem={({ item }) => <Pressable style={styles.choice} onPress={() => {
                if (!moveTarget) return;
                const id = moveTarget;
                setMoveTarget(null);
                void session.moveThread(id, item.id).catch((e: unknown) =>
                  Alert.alert('移动失败', String(e)));
              }}><Text style={styles.choiceName}>{item.name}</Text></Pressable>} />
          </View>
        </View>
      </Modal>
      <Modal visible={rootTarget !== null} animationType="slide" transparent
        onRequestClose={() => setRootTarget(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>选择项目工作目录</Text>
              <Pressable onPress={() => setRootTarget(null)}><Text style={styles.close}>取消</Text></Pressable>
            </View>
            <FlatList style={styles.threadList} data={rootTarget?.roots ?? []}
              keyExtractor={(item) => item} renderItem={({ item }) => (
                <Pressable style={styles.choice} onPress={() => {
                  const target = rootTarget;
                  if (!target) return;
                  setRootTarget(null);
                  void session.createThread(target.id, item).then(() => setThreadChooser(false))
                    .catch((e: unknown) => Alert.alert('无法新建', String(e)));
                }}><Text style={styles.choiceName}>{item}</Text></Pressable>
              )} />
          </View>
        </View>
      </Modal>
      <Modal visible={renameTarget !== null} animationType="fade" transparent
        onRequestClose={() => setRenameTarget(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>重命名会话</Text>
              <Pressable onPress={() => setRenameTarget(null)}><Text style={styles.close}>取消</Text></Pressable>
            </View>
            <TextInput style={styles.field} value={renameValue} onChangeText={setRenameValue}
              maxLength={80} placeholder="新标题" placeholderTextColor="#7e8b9b" />
            <Pressable style={styles.primary} onPress={() => {
              if (!renameTarget) return;
              const id = renameTarget;
              setRenameTarget(null);
              void session.renameThread(id, renameValue).catch((e: unknown) =>
                Alert.alert('重命名失败', String(e)));
            }}><Text style={styles.primaryText}>保存名称</Text></Pressable>
          </View>
        </View>
      </Modal>
      <DiagnosticsPanel visible={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
    </SafeAreaView>
  );
}

class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { crashed: boolean; diagnosticsOpen: boolean }
> {
  state = { crashed: false, diagnosticsOpen: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  componentDidCatch(error: Error): void {
    // Only the error category is recorded. Never persist error.message or stack.
    logDiagnostic('app.reactRenderFailed', classifyDiagnosticError(error));
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <View style={styles.loading}>
        <Text style={styles.error}>应用界面出现异常，可以导出诊断日志排查。</Text>
        <Pressable accessibilityRole="button" onPress={() => {
          logDiagnostic('diagnostics.crashScreenPressed');
          this.setState({ diagnosticsOpen: true });
        }}>
          <Text style={styles.headerActionText}>导出诊断日志</Text>
        </Pressable>
        <DiagnosticsPanel visible={this.state.diagnosticsOpen}
          onClose={() => this.setState({ diagnosticsOpen: false })} />
      </View>
    );
  }
}

export default function App() {
  return <AppErrorBoundary><SafeAreaProvider><MainApp /></SafeAreaProvider></AppErrorBoundary>;
}

const styles = StyleSheet.create({
  loading: { backgroundColor: '#111820', flex: 1, justifyContent: 'center' },
  container: { flex: 1, backgroundColor: '#111820' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#24303b' },
  hostButton: { flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 },
  hostName: { color: '#ecf4fa', fontSize: 17, fontWeight: '700' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#8b6262' },
  online: { backgroundColor: '#5cbe9a' },
  headerAction: { paddingHorizontal: 10, paddingVertical: 6 },
  headerActionText: { color: '#addad4', fontSize: 14 },
  subheader: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  threadTitle: { color: '#edf3fc', fontWeight: '600', fontSize: 16 },
  cwd: { color: '#92a1b1', fontSize: 12, marginTop: 5 },
  error: { color: '#f5af98', backgroundColor: '#35272a', paddingHorizontal: 14, paddingVertical: 8, fontSize: 12 },
  center: { flex: 1, gap: 18, justifyContent: 'center', alignItems: 'center', padding: 28 },
  empty: { color: '#acb9ca', textAlign: 'center' },
  primary: { backgroundColor: '#b7e4d5', padding: 13, borderRadius: 14, alignItems: 'center', marginVertical: 8 },
  primaryText: { color: '#152b29', fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#1b2631',
    paddingHorizontal: 18, paddingTop: 20, paddingBottom: 28, maxHeight: '88%', gap: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sheetTitle: { fontSize: 19, color: '#eef4fd', fontWeight: '700' },
  close: { color: '#a8e3d2', fontWeight: '600', fontSize: 15 },
  choice: { borderBottomColor: '#314151', borderBottomWidth: 1, paddingVertical: 13 },
  choiceName: { color: '#eff5fe', fontSize: 15 },
  choiceHint: { color: '#91a3b4', fontSize: 11, marginTop: 6 },
  helper: { color: '#9aa8b7', fontSize: 12, lineHeight: 18 },
  field: { backgroundColor: '#101922', borderRadius: 12, color: '#eff4fa', borderColor: '#455567',
    borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  relogin: { color: '#efbc9c', textAlign: 'center', padding: 6 },
  projectScroll: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, maxHeight: 120 },
  projectChip: { maxWidth: 130, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12,
    backgroundColor: '#283443' },
  activeChip: { backgroundColor: '#38675d' },
  chipText: { color: '#e9f2fc', fontSize: 12 },
  threadList: { maxHeight: 390 },
  disabled: { opacity: 0.3 },
});
