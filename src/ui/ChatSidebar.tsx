import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DemoConversation } from '../demo/conversations';
import { palette } from './theme';

export function ChatSidebar({ visible, selectedId, conversations, onClose, onNew, onChoose, onAccount }: {
  visible: boolean;
  selectedId: string;
  conversations: readonly DemoConversation[];
  onClose: () => void;
  onNew: () => void;
  onChoose: (id: string) => void;
  onAccount: () => void;
}) {
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="关闭侧边栏" style={styles.scrim} onPress={onClose} />
      <SafeAreaView edges={['top', 'bottom']} style={styles.panel}>
        <Pressable accessibilityRole="button" accessibilityLabel="新建测试聊天" style={styles.newChat} onPress={onNew}>
          <Text style={styles.newIcon}>✎</Text><Text style={styles.newText}>新聊天</Text>
        </Pressable>
        <Text style={styles.section}>聊天记录</Text>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {conversations.map((conversation) => <Pressable
            key={conversation.id}
            accessibilityRole="button"
            accessibilityState={{ selected: conversation.id === selectedId }}
            onPress={() => onChoose(conversation.id)}
            style={[styles.chat, conversation.id === selectedId && styles.selected]}
          ><Text style={styles.chatName} numberOfLines={1}>{conversation.title}</Text></Pressable>)}
        </ScrollView>
        <Pressable style={styles.profile} onPress={onAccount} accessibilityRole="button" accessibilityLabel="测试用户，账户与 OAuth 认证">
          <View style={styles.avatar}><Text style={styles.avatarText}>测</Text></View>
          <Text style={styles.name}>测试用户</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#00000099' },
  panel: { width: '83%', maxWidth: 350, flex: 1, backgroundColor: palette.sidebar, paddingHorizontal: 12 },
  newChat: { paddingHorizontal: 16, marginTop: 13, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 18 },
  newIcon: { color: palette.text, fontSize: 23 }, newText: { color: palette.text, fontSize: 15, fontWeight: '600' },
  section: { paddingHorizontal: 14, paddingTop: 23, paddingBottom: 10, fontSize: 12, color: palette.subtle },
  list: { flex: 1 }, chat: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, marginBottom: 2 },
  selected: { backgroundColor: palette.selected }, chatName: { color: palette.text, fontSize: 14 },
  profile: { borderTopWidth: 1, borderTopColor: palette.outline, paddingHorizontal: 10, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#5d7c70', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  name: { color: palette.text, fontSize: 14, fontWeight: '600' }, chevron: { color: palette.subtle, fontSize: 25, marginLeft: 'auto' },
});
