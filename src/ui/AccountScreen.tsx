import React, { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChatHost } from './chatModels';

type Props = {
  hosts: readonly ChatHost[];
  selectedHostId: string | null;
  globalRules: string;
  onSelectHost: (id: string) => void;
  onRenameHost: (id: string, name: string) => void;
  onRemoveHost: (id: string) => void;
  onConnect: () => void;
  onRulesChange: (text: string) => void;
  onExpandRules: () => void;
};

export function AccountScreen({
  hosts, selectedHostId, globalRules, onSelectHost, onRenameHost, onRemoveHost,
  onConnect, onRulesChange, onExpandRules,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const consumedLongPress = useRef<string | null>(null);

  const showMenu = (host: ChatHost) => {
    Alert.alert(host.name, '真实 Codex 电脑连接）', [
      { text: '重命名', onPress: () => { setRenamingId(host.id); setRenameText(host.name); } },
      { text: '重新连接', onPress: () => onSelectHost(host.id) },
      { text: '断开连接', style: 'destructive', onPress: () => onRemoveHost(host.id) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return <ScrollView style={styles.root} contentContainerStyle={styles.content}
    keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <Text style={styles.sectionLabel}>电脑</Text>
    <View style={styles.group}>
      {hosts.map((host) => <Pressable key={host.id}
        accessibilityRole="button"
        accessibilityLabel={host.name}
        accessibilityState={{ selected: selectedHostId === host.id }}
        onPress={() => {
          if (consumedLongPress.current === host.id) {
            consumedLongPress.current = null;
            return;
          }
          onSelectHost(host.id);
        }}
        onLongPress={() => {
          consumedLongPress.current = host.id;
          showMenu(host);
        }}
        onPressOut={() => {
          if (consumedLongPress.current !== host.id) return;
          setTimeout(() => {
            if (consumedLongPress.current === host.id) consumedLongPress.current = null;
          }, 500);
        }}
        delayLongPress={450}
        style={styles.hostRow}>
        <Text style={styles.hostGlyph}>▣</Text>
        <View style={styles.hostBody}>
          <Text style={styles.hostName}>{host.name}</Text>
          <Text style={styles.hostSubtitle}>Codex Gateway · 需要有效授权</Text>
        </View>
        {selectedHostId === host.id && <Text style={styles.selectedHost}>✓</Text>}
      </Pressable>)}
      <Pressable onPress={onConnect} accessibilityRole="button"
        accessibilityLabel="连接新的电脑" style={styles.connectRow}>
        <Text style={styles.plus}>＋</Text>
        <Text style={styles.connectText}>连接新的电脑</Text>
      </Pressable>
    </View>
    <View style={styles.rulesHeading}>
      <Text style={styles.sectionLabel}>全局规则</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="最大化全局规则"
        onPress={onExpandRules} style={styles.expandTouch}>
        <Text style={styles.expandGlyph}>⛶</Text>
      </Pressable>
    </View>
    <View style={styles.rulesContainer}>
      <TextInput
        accessibilityLabel="全局规则纯文本"
        value={globalRules}
        onChangeText={onRulesChange}
        multiline
        textAlignVertical="top"
        scrollEnabled
        autoCapitalize="none"
        placeholder="输入全局规则。支持换行和纯文本，不渲染 Markdown。"
        placeholderTextColor="#828282"
        style={styles.rulesText}
      />
    </View>
    <Text style={styles.note}>规则只作为本机备注保存，不会改变 Codex 服务端权限或规则。</Text>
    {renamingId && <View style={styles.renameLayer}>
      <Text style={styles.renameTitle}>重命名电脑</Text>
      <TextInput autoFocus value={renameText} onChangeText={setRenameText}
        style={styles.renameInput} accessibilityLabel="电脑名称" />
      <View style={styles.renameButtons}>
        <Pressable onPress={() => setRenamingId(null)}><Text style={styles.secondary}>取消</Text></Pressable>
        <Pressable onPress={() => { onRenameHost(renamingId, renameText); setRenamingId(null); }}>
          <Text style={styles.primary}>确定</Text>
        </Pressable>
      </View>
    </View>}
  </ScrollView>;
}

export function FullRulesEditor({
  title, text, onChange, onDone,
}: { title: string; text: string; onChange: (value: string) => void; onDone: () => void }) {
  return <View style={styles.editorRoot}>
    <View style={styles.editorHeader}>
      <Text style={styles.editorTitle}>{title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="完成编辑"
        onPress={onDone}><Text style={styles.primary}>完成</Text></Pressable>
    </View>
    <TextInput
      accessibilityLabel={title}
      autoFocus
      multiline
      textAlignVertical="top"
      autoCapitalize="none"
      value={text}
      onChangeText={onChange}
      placeholder="输入纯文本规则"
      placeholderTextColor="#808080"
      style={styles.fullText}
    />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { paddingHorizontal: 17, paddingTop: 20, paddingBottom: 48 },
  sectionLabel: { color: '#eeeeee', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  group: { backgroundColor: '#272727', borderRadius: 19, overflow: 'hidden' },
  hostRow: { minHeight: 68, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 13,
    borderBottomColor: '#3a3a3a', borderBottomWidth: StyleSheet.hairlineWidth },
  hostGlyph: { fontSize: 25, color: '#ddd' },
  hostBody: { flex: 1 },
  hostName: { fontSize: 15, color: '#f4f4f4', fontWeight: '600' },
  hostSubtitle: { fontSize: 11, marginTop: 5, color: '#9e9e9e' },
  selectedHost: { fontSize: 20, color: '#8cb3ff' },
  connectRow: { paddingHorizontal: 15, minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 15 },
  plus: { fontSize: 25, color: '#ddd' }, connectText: { fontSize: 15, color: '#eee' },
  rulesHeading: { marginTop: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expandTouch: { width: 46, height: 43, alignItems: 'center', justifyContent: 'center' },
  expandGlyph: { color: '#ddd', fontSize: 25 },
  rulesContainer: { backgroundColor: '#272727', borderRadius: 21, minHeight: 220, padding: 16 },
  rulesText: { color: '#f4f4f4', fontSize: 15, lineHeight: 23, minHeight: 188, padding: 0 },
  note: { color: '#898989', fontSize: 12, paddingHorizontal: 6, marginTop: 12 },
  renameLayer: { marginTop: 18, backgroundColor: '#303030', borderRadius: 16, padding: 17 },
  renameTitle: { color: '#fff', fontSize: 16, marginBottom: 12 },
  renameInput: { height: 47, paddingHorizontal: 12, color: '#fff', backgroundColor: '#222', borderRadius: 10 },
  renameButtons: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18, gap: 28 },
  secondary: { color: '#ddd', fontSize: 15 }, primary: { color: '#94b9ff', fontSize: 15, fontWeight: '600' },
  editorRoot: { flex: 1, backgroundColor: '#000', paddingHorizontal: 16 },
  editorHeader: { height: 53, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editorTitle: { color: '#fff', fontSize: 17, fontWeight: '600' },
  fullText: { flex: 1, color: '#f0f0f0', fontSize: 16, lineHeight: 24, backgroundColor: '#252525',
    borderRadius: 18, paddingHorizontal: 18, paddingVertical: 15, marginBottom: 12 },
});
