import React, { useEffect, useReducer, useState } from 'react';
import { BackHandler, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { demoReducer, initialDemoState } from './src/demo/conversations';
import { AccountScreen } from './src/ui/AccountScreen';
import { ChatSidebar } from './src/ui/ChatSidebar';
import { DemoChat } from './src/ui/DemoChat';
import { palette } from './src/ui/theme';

function MainApp() {
  const [demo, dispatch] = useReducer(demoReducer, initialDemoState);
  const [sidebar, setSidebar] = useState(false);
  const [account, setAccount] = useState(false);
  const conversation = demo.conversations.find((item) => item.id === demo.selectedId)!;

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
      {account ? <View style={styles.headerButton} /> : <Pressable
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
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><MainApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvas },
  header: { height: 56, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 49, height: 49, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 18, fontWeight: '600', color: palette.text },
  headerIcon: { fontSize: 27, color: palette.text }, composeIcon: { fontSize: 26, color: palette.text },
});
