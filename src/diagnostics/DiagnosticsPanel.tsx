import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { clearDiagnostics, logDiagnostic } from './journal';
import { diagnosticSummary, exportDiagnostics, type DiagnosticSummary } from './export';
import { classifyDiagnosticError } from './safe';

export function DiagnosticsPanel({ visible, onClose }: {
  visible: boolean;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<DiagnosticSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSummary(await diagnosticSummary());
    } catch (e) {
      logDiagnostic('diagnostics.refreshFailed', classifyDiagnosticError(e));
      setError('无法读取日志，请尝试导出当前可用数据');
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    logDiagnostic('diagnostics.panelOpened');
    setError(null);
    void refresh();
  }, [visible, refresh]);

  const share = async () => {
    logDiagnostic('diagnostics.exportPressed');
    setBusy(true);
    setError(null);
    try {
      await exportDiagnostics();
      await refresh();
    } catch (e) {
      logDiagnostic('diagnostics.exportFailed', classifyDiagnosticError(e));
      setError('导出失败：请确认设备有可用的文件分享应用，然后重试');
    } finally {
      setBusy(false);
    }
  };

  const confirmClear = () => Alert.alert(
    '清空诊断日志？',
    '这将删除本机的诊断记录，不影响聊天、授权和账号数据。',
    [
      { text: '取消', style: 'cancel' },
      { text: '清空', style: 'destructive', onPress: () => {
        void clearDiagnostics()
          .then(() => refresh())
          .catch((e: unknown) => {
            logDiagnostic('diagnostics.clearFailed', classifyDiagnosticError(e));
            setError('清空失败，请重试');
          });
      } },
    ],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>诊断日志</Text>
            <Pressable accessibilityRole="button" onPress={onClose}>
              <Text style={styles.close}>关闭</Text>
            </Pressable>
          </View>
          <Text style={styles.meta}>本机 Android 诊断日志</Text>
          <Text style={styles.meta}>
            {summary ? '记录 ' + summary.count + ' 条 · ' +
              (summary.durableStorageAvailable ? '可跨重启保存' : '持久化不可用，仅保留运行期记录') :
              '正在读取日志…'}
          </Text>
          <Text style={styles.hint}>
            复现连接、网页加载或后台通知问题后，可回到这里导出 JSON 文件。
            日志仅包含安全的事件类别与状态，不包含授权密钥、电脑地址或聊天正文。
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            style={[styles.exportButton, busy && styles.disabled]}
            onPress={() => { void share(); }}
          >
            {busy ? <ActivityIndicator color="#13253b" /> : <Text style={styles.exportText}>导出 JSON 日志（系统分享）</Text>}
          </Pressable>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => { void refresh(); }}>
              <Text style={styles.action}>刷新列表</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={confirmClear}>
              <Text style={styles.danger}>清空日志</Text>
            </Pressable>
          </View>
          <Text style={styles.sectionTitle}>最近事件（完整信息请导出文件）</Text>
          <ScrollView style={styles.events}>
            {summary?.latest.length ? summary.latest.map((line, index) =>
              <Text key={index} style={styles.eventLine}>{line}</Text>) :
              <Text style={styles.hint}>尚无事件记录，尝试点击授权按钮。</Text>}
          </ScrollView>
          <Text style={styles.footer}>日志最多保留约 1,800 条和 7 天记录。Android 系统崩溃日志需要通过 adb 获取。</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#1b2631', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 36, maxHeight: '92%', gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#edf3fc', fontWeight: '700', fontSize: 21 },
  close: { color: '#a8e3d2', fontSize: 16 },
  meta: { color: '#d6e2f0', fontSize: 13 },
  hint: { color: '#a5b4c6', fontSize: 13, lineHeight: 21 },
  exportButton: { borderRadius: 13, backgroundColor: '#b8d1f9', alignItems: 'center', padding: 15 },
  exportText: { color: '#13253b', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  error: { color: '#ff9d9d', fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  action: { color: '#a8e3d2', fontSize: 14 },
  danger: { color: '#ffb0ae', fontSize: 14 },
  sectionTitle: { color: '#d7e6f1', fontWeight: '600', fontSize: 14 },
  events: { maxHeight: 175, backgroundColor: '#111a24', borderRadius: 12, padding: 10 },
  eventLine: { color: '#b4c4d2', fontSize: 12, paddingVertical: 4, fontFamily: 'monospace' },
  footer: { color: '#91a3b4', fontSize: 11, lineHeight: 17 },
});
