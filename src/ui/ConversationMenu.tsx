import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ReferenceIcon, type ReferenceIconName } from './ReferenceIcons';

export type ConversationMenuAction = 'copy-id' | 'pin' | 'move-out' | 'find' | 'archive' | 'delete';

type Props = {
  visible: boolean;
  hasProject: boolean;
  pinned: boolean;
  archived: boolean;
  onClose: () => void;
  onAction: (action: ConversationMenuAction) => void;
};

export function ConversationMenu({ visible, hasProject, pinned, archived, onClose, onAction }: Props) {
  const items: Array<{ action: ConversationMenuAction; label: string; icon: ReferenceIconName; danger?: boolean }> = [
    { action: 'copy-id', label: '复制对话串 ID', icon: 'copy' },
    { action: 'pin', label: pinned ? '取消置顶' : '置顶', icon: 'pin' },
    ...(hasProject ? [{ action: 'move-out' as const, label: '从项目中移除', icon: 'folder' as const }] : []),
    { action: 'find', label: '在聊天中查找', icon: 'search' },
    { action: 'archive', label: archived ? '取消归档' : '归档', icon: 'archive' },
    { action: 'delete', label: '删除', icon: 'trash', danger: true },
  ];
  return <Modal transparent statusBarTranslucent animationType="fade" visible={visible}
    onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭对话菜单" />
      <View style={styles.menu}>
        <Text style={styles.caption}>Codex 会话操作</Text>
        {items.map((item) => <Pressable key={item.action} accessibilityRole="button"
          accessibilityLabel={item.label} style={styles.row}
          onPress={() => { onClose(); onAction(item.action); }}>
          <ReferenceIcon name={item.icon} size={24} color={item.danger ? '#fb4454' : '#f2f2f2'} />
          <Text style={[styles.label, item.danger && styles.danger]}>{item.label}</Text>
        </Pressable>)}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, paddingTop: 96, paddingRight: 15, alignItems: 'flex-end', backgroundColor: '#00000052' },
  menu: { width: '75%', maxWidth: 324, borderRadius: 20, backgroundColor: '#303030',
    paddingTop: 13, paddingBottom: 12, borderWidth: 1, borderColor: '#444' },
  caption: { paddingHorizontal: 23, paddingBottom: 9, fontSize: 14, color: '#aaa' },
  row: { minHeight: 54, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 18 },
  label: { color: '#eee', fontSize: 17, flexShrink: 1 },
  danger: { color: '#ff5161' },
});
