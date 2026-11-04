import React, { useMemo } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime,
  type AppendMessage, type ThreadMessageLike,
} from '@assistant-ui/react-native';
import type { DemoConversation } from '../demo/conversations';
import { palette } from './theme';

function Bubble({ role }: { role: 'user' | 'assistant' }) {
  return <MessagePrimitive.Root style={[styles.messageRow, role === 'user' && styles.right]}>
    <View style={role === 'user' ? styles.userBubble : styles.assistantBubble}>
      <MessagePrimitive.Parts>
        {({ part }) => part.type === 'text'
          ? <Text selectable style={styles.messageText}>{part.text}</Text>
          : <Text style={styles.messageText}>[不支持的消息]</Text>}
      </MessagePrimitive.Parts>
    </View>
  </MessagePrimitive.Root>;
}

export function DemoChat({ conversation, onDraft, onSend }: {
  conversation: DemoConversation;
  onDraft: (text: string) => void;
  onSend: () => void;
}) {
  const messages = useMemo<ThreadMessageLike[]>(() => conversation.messages.map((message) => ({
    id: message.id, role: message.role, content: [{ type: 'text' as const, text: message.text }],
  })), [conversation.messages]);
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message: ThreadMessageLike) => message,
    // The demo composer manages its local draft; runtime is exclusively for native rendering.
    onNew: async (_message: AppendMessage) => { onSend(); },
    isRunning: false,
  });

  return <AssistantRuntimeProvider runtime={runtime}>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ThreadPrimitive.Root style={styles.thread}>
        <ThreadPrimitive.MessagesFlatList
          key={conversation.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          autoScroll
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<View style={styles.empty}>
            <Text style={styles.greeting}>有什么可以帮忙的？</Text>
            <Text style={styles.caption}>本地演示聊天 · 无需登录</Text>
          </View>}
        >
          {({ message }) => <Bubble role={message.role === 'user' ? 'user' : 'assistant'} />}
        </ThreadPrimitive.MessagesFlatList>
        <View style={styles.composerArea}>
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="消息输入框"
              style={styles.input}
              placeholder="询问任何问题"
              placeholderTextColor={palette.subtle}
              multiline
              maxLength={12000}
              textAlignVertical="center"
              value={conversation.draft}
              onChangeText={onDraft}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="发送消息"
              onPress={onSend}
              disabled={!conversation.draft.trim()}
              style={[styles.sendButton, !conversation.draft.trim() && styles.disabledSend]}
            ><Text style={styles.sendGlyph}>↑</Text></Pressable>
          </View>
          <Text style={styles.notice}>当前为测试模式，回复内容均为「测试成功」</Text>
        </View>
      </ThreadPrimitive.Root>
    </KeyboardAvoidingView>
  </AssistantRuntimeProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, thread: { flex: 1, backgroundColor: palette.canvas },
  list: { flex: 1 }, listContent: { paddingHorizontal: 16, paddingVertical: 22, gap: 16, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 56 },
  greeting: { fontSize: 23, fontWeight: '600', color: palette.text },
  caption: { fontSize: 13, color: palette.subtle },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  userBubble: { backgroundColor: '#373737', maxWidth: '87%', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11 },
  assistantBubble: { maxWidth: '98%', paddingHorizontal: 4, paddingVertical: 5 },
  messageText: { color: palette.text, fontSize: 16, lineHeight: 24 },
  composerArea: { paddingHorizontal: 12, paddingBottom: 8, paddingTop: 5 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 27, backgroundColor: palette.surface, paddingHorizontal: 13, paddingVertical: 9, minHeight: 52 },
  input: { flex: 1, color: palette.text, fontSize: 16, minHeight: 34, maxHeight: 140, paddingVertical: 5, paddingRight: 9 },
  sendButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.white, justifyContent: 'center', alignItems: 'center' },
  disabledSend: { backgroundColor: '#717171' },
  sendGlyph: { color: '#212121', fontSize: 25, fontWeight: '600', marginTop: -3 },
  notice: { textAlign: 'center', color: palette.faint, fontSize: 10, paddingTop: 7 },
});
