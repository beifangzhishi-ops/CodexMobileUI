import React, { useEffect, useReducer, useState } from 'react';
import { AppState, BackHandler, Linking, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { demoReducer, initialDemoState } from './src/demo/conversations';
import { AccountScreen } from './src/ui/AccountScreen';
import { ChatSidebar } from './src/ui/ChatSidebar';
import { DemoChat } from './src/ui/DemoChat';
import { palette } from './src/ui/theme';
import { DiagnosticsPanel } from './src/diagnostics/DiagnosticsPanel';
import { logDiagnostic } from './src/diagnostics/journal';
import { classifyDiagnosticError } from './src/diagnostics/safe';

function MainApp() {
  const [demo, dispatch] = useReducer(demoReducer, initialDemoState);
  const [sidebar, setSidebar] = useState(false);
  const [account, setAccount] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const conversation = demo.conversations.find((item) => item.id === demo.selectedId)!;

  useEffect(() => {
    logDiagnostic('app.started', { platform: Platform.OS, appState: AppState.currentState });
    const appSubscription = AppState.addEventListener('change', (state) => {
      logDiagnostic('app.stateChanged', { appState: state });
    });
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      // Never store the raw deep link: it may contain a PKCE code or state.
      logDiagnostic('app.deepLinkReceived', { schemeMatched: url.startsWith('codexmobileui://') });
    });
    void Linking.getInitialURL().then((url) => {
      logDiagnostic('app.initialLinkChecked', {
        codePresent: Boolean(url),
        schemeMatched: Boolean(url?.startsWith('codexmobileui://')),
      });
    }).catch((error: unknown) => logDiagnostic('app.initialLinkFailed', classifyDiagnosticError(error)));
    return () => {
      appSubscription.remove();
      linkSubscription.remove();
      logDiagnostic('app.unmounted');
    };
  }, []);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sidebar) { setSidebar(false); return true; }
      if (account) { setAccount(false); return true; }
      return false;
    });
    return () => listener.remove();
  }, [sidebar, account]);

  const newConversation = () => { dispatch({ type: 'new' }); setSidebar(false); setAccount(false); };
  const selectConversation = (id: string) => { dispatch({ type: 'select', id }); setSidebar(false); };
  const openAccount = () => { setSidebar(false); setAccount(true); };

  return <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
    <StatusBar barStyle="light-content" />
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={account ? '返回聊天' : '打开左侧边栏'}
        onPress={() => account ? setAccount(false) : setSidebar(true)}
        style={styles.headerButton}
      ><Text style={styles.headerIcon}>{account ? '‹' : '☰'}</Text></Pressable>
      <Text style={styles.heading}>{account ? '账户' : 'ChatGPT'}</Text>
      {account ? <Pressable
        accessibilityRole="button"
        accessibilityLabel="诊断日志"
        onPressIn={() => logDiagnostic('diagnostics.headerPressIn')}
        onPress={() => {
          logDiagnostic('diagnostics.headerPressed');
          setDiagnosticsOpen(true);
        }}
        style={styles.headerButton}
      ><Text style={styles.logLabel}>日志</Text></Pressable> : <Pressable
        accessibilityRole="button"
        accessibilityLabel="新建聊天"
        onPress={newConversation}
        style={styles.headerButton}
      ><Text style={styles.composeIcon}>✎</Text></Pressable>}
    </View>
    {account ? <AccountScreen /> : <DemoChat
      conversation={conversation}
      onDraft={(text) => dispatch({ type: 'draft', text })}
      onSend={() => dispatch({ type: 'send' })}
    />}
    <ChatSidebar
      visible={sidebar}
      selectedId={demo.selectedId}
      conversations={demo.conversations}
      onClose={() => setSidebar(false)}
      onNew={newConversation}
      onChoose={selectConversation}
      onAccount={openAccount}
    />
    <DiagnosticsPanel visible={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
  </SafeAreaView>;
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
    // Only store allowlisted error categories, never stack or message.
    logDiagnostic('app.reactRenderFailed', classifyDiagnosticError(error));
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return <View style={styles.errorScreen}>
      <Text style={styles.errorText}>界面出现异常，请导出诊断日志排查。</Text>
      <Pressable accessibilityRole="button" onPress={() => {
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
  root: { flex: 1, backgroundColor: palette.canvas },
  header: { height: 56, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 49, height: 49, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 18, fontWeight: '600', color: palette.text },
  headerIcon: { fontSize: 27, color: palette.text }, composeIcon: { fontSize: 26, color: palette.text },
  logLabel: { fontSize: 14, fontWeight: '600', color: palette.text },
  errorScreen: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 25 },
  errorText: { color: palette.text, fontSize: 16 },
});
