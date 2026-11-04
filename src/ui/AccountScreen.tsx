import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { OAuthLogin } from '../auth/Login';
import { clearTokens, hasTokens } from '../auth/tokens';
import { parseHost, type Host } from '../core/host';
import { loadHosts, storeHost } from '../storage/database';
import { palette } from './theme';

export function AccountScreen() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [entry, setEntry] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void loadHosts().then((result) => {
      if (!active) return;
      setHosts(result);
      setSelectedHost(result[0] ?? null);
    }).catch((error: unknown) => {
      if (active) Alert.alert('无法读取电脑列表', error instanceof Error ? error.message : String(error));
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setAuthorized(false);
    if (selectedHost) void hasTokens(selectedHost).then((value) => {
      if (active) setAuthorized(value);
    }).catch(() => { if (active) setAuthorized(false); });
    return () => { active = false; };
  }, [selectedHost?.id]);

  const addHost = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const host = parseHost(entry);
      await storeHost(host);
      setHosts((previous) => previous.some((item) => item.id === host.id) ? previous : [...previous, host]);
      setSelectedHost(host);
      setEntry('');
    } catch (error: unknown) {
      Alert.alert('无法添加电脑', error instanceof Error ? error.message : '请输入 HTTPS 根地址');
    } finally { setSaving(false); }
  };

  const reauthorize = () => {
    if (!selectedHost) return;
    Alert.alert('重新授权', '将清除当前电脑在本机保存的 OAuth 令牌。', [
      { text: '取消', style: 'cancel' },
      { text: '清除令牌', style: 'destructive', onPress: () => {
        void clearTokens(selectedHost).then(() => setAuthorized(false))
          .catch((error: unknown) => Alert.alert('清除失败', String(error)));
      } },
    ]);
  };

  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View style={styles.avatar}><Text style={styles.avatarText}>测</Text></View>
    <Text style={styles.name}>测试用户</Text>
    <Text style={styles.description}>聊天界面处于本地测试模式。OAuth 认证是独立功能，不会连接真实 Codex 聊天。</Text>
    <View style={styles.divider} />
    <Text style={styles.section}>电脑连接</Text>
    <Text style={styles.description}>选择已保存的电脑，或输入 HTTPS Funnel 根地址。仅点击授权按钮后才打开系统浏览器。</Text>
    {checking ? <ActivityIndicator color={palette.text} /> : hosts.map((host) => (
      <Pressable
        key={host.id}
        accessibilityRole="button"
        accessibilityState={{ selected: selectedHost?.id === host.id }}
        onPress={() => setSelectedHost(host)}
        style={[styles.host, selectedHost?.id === host.id && styles.activeHost]}
      >
        <Text style={styles.hostName}>{host.name}</Text>
        <Text style={styles.hostUrl} numberOfLines={1}>{host.baseUrl}</Text>
      </Pressable>
    ))}
    <TextInput
      accessibilityLabel="电脑 HTTPS 根地址"
      style={styles.field}
      value={entry}
      onChangeText={setEntry}
      placeholder="https://your-host.ts.net"
      placeholderTextColor={palette.subtle}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
    />
    <Pressable accessibilityRole="button" onPress={() => { void addHost(); }} disabled={saving || !entry.trim()} style={[styles.add, (saving || !entry.trim()) && styles.disabled]}>
      <Text style={styles.addText}>{saving ? '正在保存…' : '添加电脑'}</Text>
    </Pressable>
    {selectedHost ? (
      authorized ? <View style={styles.authStatus}>
        <Text style={styles.authorized}>✓ 已授权：{selectedHost.name}</Text>
        <Pressable accessibilityRole="button" onPress={reauthorize}><Text style={styles.reauthorize}>清除令牌并重新授权</Text></Pressable>
      </View> : <OAuthLogin key={selectedHost.id} host={selectedHost} onConnected={() => setAuthorized(true)} />
    ) : <Text style={styles.description}>添加电脑地址后即可开始 OAuth 授权。</Text>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingVertical: 24, paddingBottom: 70, gap: 14 },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#5d7c70', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: palette.white, fontSize: 30, fontWeight: '600' },
  name: { color: palette.text, fontWeight: '600', fontSize: 23 },
  description: { fontSize: 14, color: palette.subtle, lineHeight: 21 },
  divider: { height: 1, backgroundColor: palette.outline, marginVertical: 12 },
  section: { color: palette.text, fontWeight: '600', fontSize: 18 },
  host: { backgroundColor: palette.surface, borderRadius: 14, padding: 15, borderWidth: 1, borderColor: 'transparent', gap: 5 },
  activeHost: { borderColor: palette.green }, hostName: { fontSize: 15, color: palette.text },
  hostUrl: { fontSize: 12, color: palette.subtle },
  field: { backgroundColor: palette.surface, color: palette.text, fontSize: 15, paddingHorizontal: 15, height: 52, borderRadius: 13 },
  add: { borderRadius: 14, backgroundColor: palette.white, height: 46, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 }, addText: { color: palette.canvas, fontWeight: '700' },
  authStatus: { paddingVertical: 16, gap: 12 }, authorized: { color: palette.green, fontSize: 15 },
  reauthorize: { color: palette.text, textDecorationLine: 'underline', paddingVertical: 8 },
});
