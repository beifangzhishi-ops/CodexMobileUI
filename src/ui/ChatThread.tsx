import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Pressable, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import {
  AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage, type ThreadMessageLike,
} from '@assistant-ui/react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import type { Host } from '../core/host';
import type { CodexSession } from '../session/useCodexSession';
import { loadDraft, storeDraft } from '../storage/database';
import { isolatedHostCacheKey } from '../storage/profile';

function Markdown({ source }: { source: string }) {
  return (
    <EnrichedMarkdownText
      flavor="github"
      markdown={source}
      enableTaskListItemToggle={false}
      onLinkPress={({ url }) => {
        if (/^https:\/\//.test(url) || /^mailto:/.test(url)) {
          void Linking.openURL(url).catch(() => Alert.alert('无法打开链接'));
        } else {
          Alert.alert('这是电脑端文件或未支持的链接', url);
        }
      }}
    />
  );
}

function ChatBubble({ user }: { user: boolean }) {
  return (
    <MessagePrimitive.Root style={[styles.row, user && styles.userRow]}>
      <View style={[styles.bubble, user ? styles.userBubble : styles.assistantBubble]}>
        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === 'text') return <Markdown source={part.text} />;
            return <Text style={styles.fallback}>[暂不支持的消息内容]</Text>;
          }}
        </MessagePrimitive.Parts>
      </View>
    </MessagePrimitive.Root>
  );
}

function Composer({ host, session }: { host: Host; session: CodexSession }) {
  const threadId = session.draftKey!;
  const [draft, setDraft] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    void loadDraft(isolatedHostCacheKey(host.id), threadId).then((value) => {
      if (alive) { setDraft(value); setReady(true); }
    }).catch((e: unknown) => {
      if (alive) Alert.alert('无法读取本地草稿', e instanceof Error ? e.message : '');
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, [host.id, threadId]);

  const updateDraft = useCallback((value: string) => {
    setDraft(value);
    // Write through while editing: closing the thread immediately must not
    // discard the last characters of a draft or ever queue an automatic send.
    void storeDraft(isolatedHostCacheKey(host.id), threadId, value).catch(() => {
      Alert.alert('草稿保存失败', '这段文字仍在输入框中，请不要退出应用。');
    });
  }, [host.id, threadId]);

  const send = useCallback(async () => {
    if (!draft.trim() || session.status !== 'online' || busy) return;
    setBusy(true);
    try {
      await session.send(draft.trim(), threadId);
      setDraft('');
      await storeDraft(isolatedHostCacheKey(host.id), threadId, '');
    } catch {
      // An unacknowledged turn may already have executed. Keep the draft.
      Alert.alert('发送状态不明确', '请先核对电脑端会话，避免重复发送。');
    } finally {
      setBusy(false);
    }
  }, [draft, session, busy, host.id, threadId]);

  return (
    <View style={styles.composer}>
      {session.status !== 'online' ? (
        <Text style={styles.offlineHint}>离线草稿会保存在手机，恢复网络后不会自动发送</Text>
      ) : null}
      <View style={styles.composerRow}>
        <TextInput
          style={styles.input}
          multiline
          editable={ready && !busy}
          value={draft}
          onChangeText={updateDraft}
          placeholder="发送消息给 Codex…"
          placeholderTextColor="#8190a3"
          textAlignVertical="top"
          accessibilityLabel="消息输入"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="发送"
          disabled={session.status !== 'online' || busy || session.running || !draft.trim()}
          onPress={() => { void send(); }}
          style={[styles.send, (session.status !== 'online' || busy || session.running || !draft.trim()) && styles.disabled]}
        >
          {busy ? <ActivityIndicator color="#122b32" size="small" /> :
            <Text style={styles.sendText}>↑</Text>}
        </Pressable>
      </View>
      <Text style={styles.composerFoot}>与电脑 Codex Desktop 共用会话 · 不会自动发送离线草稿</Text>
    </View>
  );
}

export function ChatThread({ host, session }: { host: Host; session: CodexSession }) {
  const messages = useMemo<ThreadMessageLike[]>(
    () => session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: [{ type: 'text' as const, text: m.text }],
    })),
    [session.messages],
  );
  const onNew = useCallback(async (message: AppendMessage) => {
    const text = message.content.filter((part) => part.type === 'text')
      .map((part) => part.text).join('\n');
    if (text) await session.send(text, session.draftKey);
  }, [session.send, session.draftKey]);
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message: ThreadMessageLike) => message,
    onNew,
    isRunning: session.running,
    isSendDisabled: session.status !== 'online',
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <KeyboardAvoidingView style={styles.keyboardAvoiding} behavior="padding">
        <ThreadPrimitive.Root style={styles.thread}>
        <ThreadPrimitive.MessagesFlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          autoScroll
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<View style={styles.empty}>
            <Text style={styles.emptyTitle}>开始与 Codex 对话</Text>
            <Text style={styles.emptyBody}>历史记录由电脑保存，手机缓存已加载的消息。</Text>
          </View>}
        >
          {({ message }) => <ChatBubble user={message.role === 'user'} />}
        </ThreadPrimitive.MessagesFlatList>
        <Composer host={host} session={session} />
        </ThreadPrimitive.Root>
      </KeyboardAvoidingView>
    </AssistantRuntimeProvider>
  );
}

const styles = StyleSheet.create({
  keyboardAvoiding: { flex: 1 },
  thread: { flex: 1, backgroundColor: '#111820' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12, paddingVertical: 18, gap: 16, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  userRow: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '94%', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18 },
  userBubble: { backgroundColor: '#253b47', borderBottomRightRadius: 5 },
  assistantBubble: { backgroundColor: '#18222d', borderBottomLeftRadius: 5 },
  fallback: { color: '#9cabbc' },
  empty: { flex: 1, minHeight: 220, justifyContent: 'center', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 20, color: '#e5eff8', fontWeight: '600' },
  emptyBody: { color: '#98a9bd', textAlign: 'center', lineHeight: 22, maxWidth: 280 },
  composer: {
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10,
    borderTopWidth: 1, borderTopColor: '#263340', backgroundColor: '#161f29',
  },
  composerRow: {
    borderRadius: 20, borderColor: '#334452', borderWidth: 1,
    backgroundColor: '#1c2834', flexDirection: 'row', alignItems: 'flex-end',
    paddingLeft: 14, paddingRight: 6, paddingVertical: 5,
  },
  input: { flex: 1, minHeight: 38, maxHeight: 150, paddingVertical: 8, color: '#edf2f9', fontSize: 16 },
  send: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#b4e6d7', alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#112b24', fontSize: 27, fontWeight: '600', marginTop: -5 },
  disabled: { opacity: 0.3 },
  offlineHint: { color: '#ffc58d', fontSize: 12, paddingVertical: 5 },
  composerFoot: { color: '#788697', fontSize: 10, textAlign: 'center', marginTop: 8 },
});
