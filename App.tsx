import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, KeyboardAvoidingView, Platform,
  Pressable, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewProps } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { DEFAULT_COORDINATOR_URL, unifiedWebUrl } from './src/core/unifiedWeb';
import { NativePublicationDownloads } from './src/core/nativePublicationDownload';
import { updateQuotaWidget } from './src/core/quotaWidget';
import { backgroundApp } from './src/core/appNavigation';
import {
  observeAppVisibility, observeTaskLinks, notificationEnabled, setTaskNotifications,
  setVisibleTask, startTaskNotifications, type TaskLink,
} from './src/core/taskNotifications';
import { loadCoordinatorUrl, storeCoordinatorUrl } from './src/storage/database';
import { DiagnosticsPanel } from './src/diagnostics/DiagnosticsPanel';
import { logDiagnostic } from './src/diagnostics/journal';

/**
 * One UI on browser, Android and (eventually) desktop.
 * Android supplies only the system container and private-network onboarding;
 * conversation rendering, actions, permissions and state all belong to web/.
 */
function SharedApp() {
  const [coordinator, setCoordinator] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [booting, setBooting] = useState(true);
  const [configuring, setConfiguring] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const web = useRef<WebView<WebViewProps>>(null);
  const downloads = useRef(new NativePublicationDownloads());
  const lastTask = useRef<TaskLink | null>(null);
  const webLoaded = useRef(false);
  const webReady = useRef(false);
  const origin = unifiedWebUrl(coordinator);

  useEffect(() => { logDiagnostic('app.started', { platform: Platform.OS }); }, []);

  const openPendingTask = useCallback(() => {
    if (!webLoaded.current || !webReady.current || !lastTask.current) return;
    const detail = lastTask.current;
    lastTask.current = null;
    web.current?.injectJavaScript(
      "window.dispatchEvent(new CustomEvent('codexmobileui:open-thread',{detail:" +
      JSON.stringify(detail) + "}));true;",
    );
  }, []);

  useEffect(() => {
    const stopLinks = observeTaskLinks((link) => {
      lastTask.current = link;
      openPendingTask();
    });
    const stopVisibility = observeAppVisibility();
    return () => { stopLinks(); stopVisibility(); };
  }, [openPendingTask]);

  useEffect(() => {
    if (!origin) return;
    webLoaded.current = false;
    webReady.current = false;
    void startTaskNotifications(origin).catch(() => undefined);
  }, [origin, reload]);

  const sendNotificationState = useCallback((enabled: boolean) => {
    web.current?.injectJavaScript(
      "window.dispatchEvent(new CustomEvent('codexmobileui:notifications-state',{detail:" +
      JSON.stringify(enabled) + "}));true;",
    );
  }, []);

  useEffect(() => {
    let active = true;
    void loadCoordinatorUrl().then((stored) => {
      if (!active) return;
      const valid = stored && unifiedWebUrl(stored) ? stored : null;
      setCoordinator(valid);
      // Upgrades from the retired HTTP entry start with the HTTPS URL filled in.
      setAddress(valid ?? DEFAULT_COORDINATOR_URL);
      setConfiguring(!valid);
    }).catch(() => {
      if (active) { setError('读取内网连接配置失败'); setConfiguring(true); }
    }).finally(() => { if (active) setBooting(false); });
    return () => { active = false; };
  }, []);

  const openConfig = useCallback(() => {
    setAddress(coordinator ?? '');
    setError(null);
    setConfiguring(true);
  }, [coordinator]);

  const connect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    setError(null);
    try {
      const selected = unifiedWebUrl(address);
      if (!selected) throw Error('INVALID_COORDINATOR');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(selected + '/healthz', { signal: controller.signal, redirect: 'error' });
        if (!response.ok || await response.text() !== 'ok') throw Error('COORDINATOR_UNAVAILABLE');
      } finally {
        clearTimeout(timeout);
      }
      // The HTTPS Coordinator hosts the shared UI and routes both machines.
      // Do not contact the retired HTTP Gateway discovery endpoint on Android.
      await storeCoordinatorUrl(selected);
      setCoordinator(selected);
      setConfiguring(false);
      setReload((value) => value + 1);
      logDiagnostic('app.connectionUpdated', { outcome: 'success' });
    } catch {
      logDiagnostic('app.connectionUpdated', { outcome: 'failed' });
      setError('无法连接内网入口。请检查 Tailscale、HTTPS 地址和 4190 端口。');
    } finally {
      setConnecting(false);
    }
  }, [address, connecting]);

  // WebView dismisses its own layers first. When there is nothing to dismiss,
  // move the Android task to the background without destroying its chat state.
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (configuring) {
        if (origin) { setConfiguring(false); return true; }
        backgroundApp();
        return true;
      }
      if (!origin || !webLoaded.current || !webReady.current) {
        backgroundApp();
        return true;
      }
      web.current?.injectJavaScript(
        "(function(){var event=new Event('codexmobileui:back',{cancelable:true});" +
        "window.dispatchEvent(event);" +
        "window.ReactNativeWebView?.postMessage(event.defaultPrevented?" +
        "'codexmobileui:back:handled':'codexmobileui:back:root');})();true;",
      );
      return true;
    });
    return () => listener.remove();
  }, [configuring, origin]);

  const allowNavigation = useCallback((navigation: WebViewNavigation) => {
    if (navigation.url === 'about:blank') return true;
    try { return !!origin && new URL(navigation.url).origin === origin; }
    catch { return false; }
  }, [origin]);

  return <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
    <StatusBar barStyle="light-content" />
    {booting ? <View style={styles.center}><ActivityIndicator color="#bbbbbb" /></View>
      : configuring || !origin ? <KeyboardAvoidingView style={styles.center}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Text style={styles.heading}>连接 Codex 内网</Text>
          <Text style={styles.description}>只需填写 6v 的 Tailnet 地址，即可访问所有电脑的会话。</Text>
          <TextInput accessibilityLabel="内网入口地址" style={styles.input}
            placeholder="https://设备名.Tailnet.ts.net:4190" placeholderTextColor="#777"
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
            value={address} onChangeText={setAddress} editable={!connecting} />
          {error && <Text style={styles.description}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityLabel="连接内网"
            style={styles.primary} disabled={connecting}
            onPress={() => { void connect(); }}>
            <Text style={styles.primaryText}>{connecting ? '连接中…' : '连接'}</Text>
          </Pressable>
          {origin && <Pressable accessibilityRole="button"
            onPress={() => { setConfiguring(false); setError(null); }}>
            <Text style={styles.secondary}>取消</Text>
          </Pressable>}
        </KeyboardAvoidingView> : error ? <View style={styles.center}>
          <Text style={styles.heading}>统一界面暂时无法访问</Text>
          <Text style={styles.description}>{error}</Text>
          <Pressable style={styles.primary} accessibilityRole="button"
            onPress={() => { setError(null); setReload((value) => value + 1); }}>
            <Text style={styles.primaryText}>重试</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={openConfig}>
            <Text style={styles.secondary}>更改内网入口</Text>
          </Pressable>
        </View> : <WebView<WebViewProps>
          key={origin + ':' + reload}
          ref={web}
          style={styles.web}
          source={{ uri: origin }}
          originWhitelist={[origin]}
          onShouldStartLoadWithRequest={allowNavigation}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          onLoadEnd={() => {
            webLoaded.current = true;
            logDiagnostic('webview.loadFinished');
            openPendingTask();
          }}
          renderLoading={() => <View style={styles.center}>
            <ActivityIndicator color="#bbbbbb" />
          </View>}
          onError={() => setError('无法加载内网网页。请检查 6v 的 4190 服务及 Tailnet。')}
          onHttpError={({ nativeEvent }) => {
            logDiagnostic('webview.httpFailed', { status: nativeEvent.statusCode });
            if (nativeEvent.url === origin + '/' && nativeEvent.statusCode >= 400) {
              setError('网页入口请求失败（HTTP ' + nativeEvent.statusCode + '）。');
            }
          }}
          onMessage={({ nativeEvent }) => {
            if (nativeEvent.data === 'codexmobileui:back:root') {
              backgroundApp();
              return;
            }
            if (nativeEvent.data === 'codexmobileui:back:handled') return;
            if (nativeEvent.data === 'codexmobileui:diagnostics:open') {
              logDiagnostic('diagnostics.openRequested');
              setDiagnosticsOpen(true);
              return;
            }
            if (nativeEvent.data === 'codexmobileui:configure') { openConfig(); return; }
            if (nativeEvent.data === 'codexmobileui:web-ready') {
              webReady.current = true;
              logDiagnostic('webview.ready');
              openPendingTask();
              return;
            }
            if (nativeEvent.data === 'codexmobileui:notifications:query') {
              void notificationEnabled().then(sendNotificationState).catch(() => undefined);
              return;
            }
            if (nativeEvent.data === 'codexmobileui:notifications:enable' ||
                nativeEvent.data === 'codexmobileui:notifications:disable') {
              const enabled = nativeEvent.data.endsWith(':enable');
              void setTaskNotifications(origin, enabled).then((success) =>
                notificationEnabled().then((current) => sendNotificationState(success ? current : false)))
                .catch(() => sendNotificationState(false));
              return;
            }
            if (nativeEvent.data.startsWith('codexmobileui:active:')) {
              try {
                const target = JSON.parse(nativeEvent.data.slice('codexmobileui:active:'.length));
                setVisibleTask(target.hostId, target.threadId);
              } catch { /* Ignore invalid WebView state. */ }
              return;
            }
            if (nativeEvent.data.startsWith('codexmobileui:quota:')) {
              updateQuotaWidget(nativeEvent.data.slice('codexmobileui:quota:'.length));
              return;
            }
            void downloads.current.handle(nativeEvent.data).then((reply) => {
              if (!reply) return;
              // Only the fixed event name and an escaped JSON payload enter JS.
              web.current?.injectJavaScript(
                "window.dispatchEvent(new CustomEvent('codexmobileui:native-reply',{detail:" +
                  JSON.stringify(reply) + "}));true;",
              );
            });
          }}
        />}
    <DiagnosticsPanel visible={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101010' },
  web: { flex: 1, backgroundColor: '#101010' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 24, gap: 20 },
  heading: { color: '#f8f8f8', fontSize: 22, fontWeight: '600', textAlign: 'center' },
  description: { color: '#bcbcbc', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  input: { color: '#fff', backgroundColor: '#252525', borderRadius: 13,
    paddingHorizontal: 15, width: '100%', minHeight: 52, fontSize: 15 },
  primary: { minWidth: 150, minHeight: 46, paddingHorizontal: 20,
    justifyContent: 'center', alignItems: 'center',
    borderRadius: 12, backgroundColor: '#3479e8' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { color: '#a8caff', fontSize: 15, padding: 8 },
});

export default function App() {
  return <SafeAreaProvider><SharedApp /></SafeAreaProvider>;
}
