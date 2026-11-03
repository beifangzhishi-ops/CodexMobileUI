import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Pressable, StatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { OAuthLogin } from './src/auth/Login';
import { clearTokens, hasTokens } from './src/auth/tokens';
import { parseHost, type Host } from './src/core/host';
import { useCodexSession } from './src/session/useCodexSession';
import { loadHosts, storeHost } from './src/storage/database';
import { ChatThread } from './src/ui/ChatThread';

function MainApp() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [currentHost, setCurrentHost] = useState<Host | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hostChooser, setHostChooser] = useState(false);
  const [threadChooser, setThreadChooser] = useState(false);
  const [hostEntry, setHostEntry] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const session = useCodexSession(authorized ? currentHost : null);

  useEffect(() => {
    void loadHosts().then((list) => {
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
    void hasTokens(currentHost).then((yes) => { if (alive) setAuthorized(yes); })
      .catch(() => { if (alive) setAuthorized(false); });
    return () => { alive = false; };
  }, [currentHost?.id]);

  const addHost = useCallback(async () => {
    try {
      const host = parseHost(hostEntry);
      await storeHost(host);
      setHosts((existing) => existing.some((h) => h.id === host.id) ? existing : [...existing, host]);
      setCurrentHost(host);
      setHostChooser(false);
      setHostEntry('');
      setProject(null);
    } catch (e) {
      Alert.alert('电脑地址无效', e instanceof Error ? e.message : '');
    }
  }, [hostEntry]);

  const projects = useMemo(() =>
    [...new Set(session.threads.map((thread) => thread.cwd).filter((cwd): cwd is string => Boolean(cwd)))],
  [session.threads]);
  const visible = session.threads.filter((thread) => project === null || thread.cwd === project);
  const selected = session.threads.find((thread) => thread.id === session.activeThreadId);
  const newThreadCwd = project ?? selected?.cwd ?? projects[0] ?? null;

  if (checking) return (
    <View style={styles.loading}><ActivityIndicator color="#ade5d7" size="large" /></View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => setHostChooser(true)} style={styles.hostButton}>
          <Text style={styles.hostName} numberOfLines={1}>{currentHost?.name ?? '选择电脑'} ▾</Text>
          <View style={[styles.statusDot, session.status === 'online' && styles.online]} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setThreadChooser(true)} style={styles.headerAction}>
          <Text style={styles.headerActionText}>会话 ☰</Text>
        </Pressable>
      </View>
      <View style={styles.subheader}>
        <Text style={styles.threadTitle} numberOfLines={1}>
          {selected?.name ?? (selected ? '未命名会话' : 'CodexMobileUI')}
        </Text>
        <Text style={styles.cwd} numberOfLines={1}>
          {selected?.cwd ?? (session.status === 'online' ? '选择或新建会话' : '离线 · 只读缓存 / 本地草稿')}
        </Text>
      </View>
      {session.error ? <Text style={styles.error} numberOfLines={3}>{session.error}</Text> : null}
      {!currentHost ? (
        <View style={styles.center}><Text style={styles.empty}>请先添加一台电脑的 HTTPS Funnel 地址。</Text></View>
      ) : !authorized ? (
        <OAuthLogin host={currentHost} onConnected={() => setAuthorized(true)} />
      ) : session.activeThreadId ? (
        <ChatThread key={currentHost.id + ':' + session.activeThreadId} host={currentHost} session={session} />
      ) : (
        <View style={styles.center}>
          <Text style={styles.empty}>还没有会话，或尚未加载历史列表。</Text>
          <Pressable
            style={styles.primary}
            disabled={session.status !== 'online'}
            onPress={() => { void session.createThread(newThreadCwd).catch((e: unknown) => Alert.alert('无法新建', String(e))); }}
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
                setCurrentHost(host); setProject(null); setHostChooser(false);
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
              <Pressable onPress={() => setProject(null)} style={[styles.projectChip, project === null && styles.activeChip]}>
                <Text style={styles.chipText}>全部</Text>
              </Pressable>
              {projects.map((cwd) => (
                <Pressable key={cwd} style={[styles.projectChip, project === cwd && styles.activeChip]} onPress={() => setProject(cwd)}>
                  <Text style={styles.chipText} numberOfLines={1}>{cwd.split(/[\\/]/).pop()}</Text>
                </Pressable>
              ))}
            </View>
            <FlatList
              style={styles.threadList}
              data={visible}
              keyExtractor={(thread) => thread.id}
              ListEmptyComponent={<Text style={styles.helper}>暂无已记录的会话</Text>}
              renderItem={({ item }) => (
                <Pressable style={styles.choice} onPress={() => {
                  void session.chooseThread(item.id);
                  setThreadChooser(false);
                }}>
                  <Text style={styles.choiceName} numberOfLines={1}>{item.name ?? '未命名会话'}</Text>
                  <Text style={styles.choiceHint} numberOfLines={1}>{item.cwd ?? '无项目'} · {item.id.slice(0, 10)}</Text>
                </Pressable>
              )}
            />
            <Pressable
              style={[styles.primary, session.status !== 'online' && styles.disabled]}
              disabled={session.status !== 'online'}
              onPress={() => {
                void session.createThread(newThreadCwd).then(() => setThreadChooser(false))
                  .catch((e: unknown) => Alert.alert('新建失败', String(e)));
              }}
            ><Text style={styles.primaryText}>＋ 新建会话</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><MainApp /></SafeAreaProvider>;
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
