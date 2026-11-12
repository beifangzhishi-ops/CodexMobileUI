import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime,
  type AppendMessage, type ThreadMessageLike,
} from '@assistant-ui/react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { DemoConversation } from '../demo/conversations';
import type { VisualTokens } from './visual-tokens';

const models = ['GPT-6.1 Sol', 'GPT-6 Astra', 'GPT-6.1 Terra', 'GPT-6 Sol', 'GPT-5.6 Sol'];
const permissions = [
  { name: '默认权限', description: '在沙盒中运行命令' },
  { name: '自动审查', description: '自动处理可安全批准的请求' },
  { name: '只读', description: '修改文件或运行命令需要批准' },
  { name: '完整访问权限', description: '仅为视觉演示，不授予实际权限' },
];

function Bubble({ role }: { role: 'user' | 'assistant' }) {
  return <MessagePrimitive.Root style={[styles.messageRow, role === 'user' && styles.right]}>
    <View style={role === 'user' ? styles.userBubble : styles.assistantBubble}>
      <MessagePrimitive.Parts>
        {({ part }) => part.type === 'text'
          ? <Text selectable style={styles.messageText}>{part.text}</Text>
          : <Text style={styles.messageText}>[暂不支持的消息内容]</Text>}
      </MessagePrimitive.Parts>
    </View>
  </MessagePrimitive.Root>;
}

export function DemoChat({ conversation, onDraft, onSend, visual }: {
  conversation: DemoConversation;
  onDraft: (text: string) => void;
  onSend: () => void;
  visual: VisualTokens;
}) {
  const [selectedModel, setSelectedModel] = useState(models[0]);
  const [selectedPermission, setSelectedPermission] = useState(permissions[0].name);
  const [panel, setPanel] = useState<'model' | 'permission' | null>(null);
  const [voiceMode, setVoiceMode] = useState<'idle' | 'recording' | 'review'>('idle');
  const [transcript, setTranscript] = useState('');
  const [volume, setVolume] = useState(1);
  const [speechError, setSpeechError] = useState('');
  const cancelled = useRef(false);
  const microphoneActive = useRef(false);

  useSpeechRecognitionEvent('result', (event) => {
    if (!cancelled.current && event.results[0]?.transcript) {
      setTranscript(event.results[0].transcript);
    }
  });
  useSpeechRecognitionEvent('volumechange', (event) => {
    setVolume(Math.max(1, Math.min(10, Math.round((event.value + 2) * 0.9))));
  });
  useSpeechRecognitionEvent('end', () => {
    microphoneActive.current = false;
    setVoiceMode((mode) => mode === 'recording' ? 'review' : mode);
  });
  useSpeechRecognitionEvent('error', (event) => {
    if (cancelled.current || event.error === 'aborted') return;
    setSpeechError(event.error === 'no-speech' ? '未检测到语音，请重试。'
      : '语音识别失败，请检查系统识别服务、网络和录音权限。');
    setVoiceMode('review');
  });

  useEffect(() => {
    // Changing recording -> review must NOT abort a pending final transcript.
    // Only navigation to a different conversation or unmount aborts the mic.
    return () => {
      if (microphoneActive.current) {
        microphoneActive.current = false;
        ExpoSpeechRecognitionModule.abort();
      }
    };
  }, [conversation.id]);

  const startSpeech = async () => {
    setPanel(null);
    setSpeechError('');
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        Alert.alert('系统语音识别不可用', '此手机暂未提供可调用的 Android 语音识别服务。');
        return;
      }
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        Alert.alert('需要麦克风权限', '请在系统设置中允许录音，才能使用语音转文字。');
        return;
      }
      cancelled.current = false;
      setTranscript('');
      setVolume(1);
      setVoiceMode('recording');
      microphoneActive.current = true;
      ExpoSpeechRecognitionModule.start({
        lang: 'zh-CN', interimResults: true, continuous: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 200 },
      });
    } catch {
      microphoneActive.current = false;
      setVoiceMode('idle');
      Alert.alert('语音识别启动失败', '请检查系统语音识别服务是否可用。');
    }
  };
  const cancelSpeech = () => {
    cancelled.current = true;
    microphoneActive.current = false;
    ExpoSpeechRecognitionModule.abort();
    setVoiceMode('idle');
    setTranscript('');
    setSpeechError('');
  };
  const stopSpeech = () => {
    ExpoSpeechRecognitionModule.stop();
    setVoiceMode('review');
  };
  const acceptSpeech = () => {
    if (voiceMode === 'recording') ExpoSpeechRecognitionModule.stop();
    if (transcript.trim()) onDraft([conversation.draft, transcript.trim()].filter(Boolean).join(' '));
    else if (!speechError) Alert.alert('没有识别到文字', '请重新录音，或直接使用键盘输入。');
    setVoiceMode('idle');
    setTranscript('');
    setSpeechError('');
  };

  const messages = useMemo<ThreadMessageLike[]>(() => conversation.messages.map((message) => ({
    id: message.id, role: message.role, content: [{ type: 'text' as const, text: message.text }],
  })), [conversation.messages]);
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message: ThreadMessageLike) => message,
    onNew: async (_message: AppendMessage) => { onSend(); },
    isRunning: conversation.running,
  });

  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root style={styles.thread}>
      <ThreadPrimitive.MessagesFlatList
        key={conversation.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        autoScroll
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<View style={styles.empty}>
          <Text style={styles.greeting}>有什么可以帮忙的？</Text>
          <Text style={styles.caption}>本地视觉演示 · 无需连接电脑</Text>
        </View>}
      >
        {({ message }) => <Bubble role={message.role === 'user' ? 'user' : 'assistant'} />}
      </ThreadPrimitive.MessagesFlatList>
      <View style={styles.composerArea}>
        {panel && <View style={styles.floatingMenu}>
          <ScrollView style={styles.floatingScroll} keyboardShouldPersistTaps="handled">
            {panel === 'model'
              ? models.map((item) => <Pressable key={item} style={styles.modelItem}
                  onPress={() => { setSelectedModel(item); setPanel(null); }}>
                  <Text style={styles.modelText}>{item}</Text>
                  {selectedModel === item && <Text style={styles.checkmark}>✓</Text>}
                </Pressable>)
              : permissions.map((item, index) => <Pressable key={item.name} style={styles.permissionItem}
                  onPress={() => { setSelectedPermission(item.name); setPanel(null); }}>
                  <Text style={[styles.permissionIcon, index === 3 && styles.warning]}>{index === 2 ? '◫' : '◇'}</Text>
                  <View style={styles.permissionCopy}>
                    <Text style={styles.modelText}>{item.name}</Text>
                    <Text style={styles.permissionDescription}>{item.description}</Text>
                  </View>
                  {selectedPermission === item.name && <Text style={styles.checkmark}>✓</Text>}
                </Pressable>)}
          </ScrollView>
        </View>}
        <View style={[styles.composer, {
          minHeight: visual.composerMinHeight,
          borderRadius: visual.composerRadius,
          backgroundColor: visual.composerBackground,
        }]}>
          {voiceMode === 'idle' ? <>
            <TextInput
              accessibilityLabel="消息输入框"
              style={styles.input}
              placeholder="询问任何问题"
              placeholderTextColor="#8d8d8d"
              multiline
              maxLength={12000}
              textAlignVertical="top"
              value={conversation.draft}
              onChangeText={onDraft}
              editable={!conversation.running}
            />
            <View style={[styles.toolbar, { height: visual.composerToolbarHeight }]}>
              <Pressable accessibilityLabel="添加附件（未接入）" style={styles.toolButton}
                onPress={() => Alert.alert('附件', '视觉版暂未实现文件上传。')}>
                <Text style={styles.toolGlyph}>＋</Text>
              </Pressable>
              <Pressable accessibilityLabel="选择审批权限" style={styles.toolButton}
                onPress={() => setPanel(panel === 'permission' ? null : 'permission')}>
                <Text style={styles.toolGlyph}>◇</Text>
              </Pressable>
              <Pressable accessibilityLabel="选择模型" style={styles.modelButton}
                onPress={() => setPanel(panel === 'model' ? null : 'model')}>
                <Text style={styles.modelLabel}>{selectedModel.replace('GPT-', '')} ▾</Text>
              </Pressable>
              <View style={styles.spacer} />
              <Pressable accessibilityLabel="语音听写" style={styles.toolButton} onPress={() => { void startSpeech(); }}>
                <Text style={styles.toolGlyph}>♩</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={conversation.draft.trim() ? '发送消息' : '实时语音对话（未接入）'}
                onPress={() => conversation.draft.trim() ? onSend()
                  : Alert.alert('实时语音对话', '视觉版暂未接入实时语音对话，请点击麦克风使用系统语音识别。')}
                disabled={conversation.running}
                style={[styles.blueButton, conversation.running && styles.disabled]}>
                {conversation.running ? <ActivityIndicator size="small" color="#fff" /> :
                  <Text style={styles.blueGlyph}>{conversation.draft.trim() ? '↑' : '◉'}</Text>}
              </Pressable>
            </View>
          </> : <>
            <View style={styles.voiceHeader}>
              <Text style={styles.voiceHint}>{voiceMode === 'recording' ? '正在听写…' : '确认识别结果'}</Text>
              <Text numberOfLines={2} style={styles.voiceTranscript}>{transcript || speechError || '请开始说话'}</Text>
            </View>
            <View style={styles.voiceToolbar}>
              <Pressable onPress={cancelSpeech} accessibilityLabel="取消听写" style={styles.voiceAction}>
                <Text style={styles.voiceActionGlyph}>×</Text>
              </Pressable>
              <View style={styles.waveform}>
                {Array.from({ length: 19 }, (_, i) => <View key={i} style={[
                  styles.waveBar, { height: 6 + ((i * 11 + volume * 4) % 22) },
                ]} />)}
              </View>
              {voiceMode === 'recording' && <Pressable onPress={stopSpeech} accessibilityLabel="停止听写"
                style={styles.voiceAction}><Text style={styles.voiceActionGlyph}>■</Text></Pressable>}
              <Pressable onPress={acceptSpeech} accessibilityLabel="确认听写文字" style={styles.confirmVoice}>
                <Text style={styles.confirmGlyph}>✓</Text>
              </Pressable>
            </View>
          </>}
        </View>
      </View>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}

const styles = StyleSheet.create({
  thread: { flex: 1, backgroundColor: '#000' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 15, paddingVertical: 20, gap: 17, flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 40, gap: 10 },
  greeting: { color: '#ededed', fontSize: 23, fontWeight: '600' },
  caption: { color: '#888', fontSize: 13 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  userBubble: { maxWidth: '87%', backgroundColor: '#303030', borderRadius: 21, paddingHorizontal: 16, paddingVertical: 11 },
  assistantBubble: { maxWidth: '99%', paddingHorizontal: 4, paddingVertical: 5 },
  messageText: { color: '#ededed', fontSize: 16, lineHeight: 24 },
  composerArea: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 10, position: 'relative' },
  composer: { backgroundColor: '#292929', borderRadius: 25, minHeight: 105, paddingTop: 12,
    paddingHorizontal: 11, paddingBottom: 9 },
  input: { color: '#fff', fontSize: 16, minHeight: 39, maxHeight: 145, paddingHorizontal: 8, paddingTop: 5, paddingBottom: 8 },
  toolbar: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolButton: { height: 38, minWidth: 36, alignItems: 'center', justifyContent: 'center' },
  toolGlyph: { color: '#dadada', fontSize: 25 },
  modelButton: { minHeight: 38, paddingHorizontal: 6, justifyContent: 'center' },
  modelLabel: { color: '#cecece', fontSize: 13 },
  spacer: { flex: 1 },
  blueButton: { height: 38, width: 38, borderRadius: 20, backgroundColor: '#3479e8', justifyContent: 'center', alignItems: 'center' },
  blueGlyph: { fontSize: 23, color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.6 },
  floatingMenu: { position: 'absolute', bottom: 119, left: 18, right: 18, zIndex: 6,
    borderRadius: 20, backgroundColor: '#343434', overflow: 'hidden', maxHeight: 350 },
  floatingScroll: { flexGrow: 0 },
  modelItem: { minHeight: 49, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modelText: { color: '#f0f0f0', fontSize: 15 },
  checkmark: { color: '#9cbfff', fontSize: 20 },
  permissionItem: { minHeight: 64, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
  permissionIcon: { fontSize: 24, color: '#ddd' },
  warning: { color: '#ffcb80' },
  permissionCopy: { flex: 1, gap: 4 },
  permissionDescription: { color: '#a6a6a6', fontSize: 12 },
  voiceHeader: { minHeight: 55, paddingHorizontal: 9 },
  voiceHint: { color: '#d5d5d5', fontSize: 13 },
  voiceTranscript: { color: '#f4f4f4', fontSize: 15, marginTop: 5 },
  voiceToolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  voiceAction: { height: 37, width: 36, alignItems: 'center', justifyContent: 'center' },
  voiceActionGlyph: { fontSize: 24, color: '#fff' },
  waveform: { flex: 1, minHeight: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  waveBar: { width: 3, backgroundColor: '#a8bbdd', borderRadius: 2 },
  confirmVoice: { width: 37, height: 37, borderRadius: 20, backgroundColor: '#3479e8',
    alignItems: 'center', justifyContent: 'center' },
  confirmGlyph: { color: '#fff', fontSize: 22, fontWeight: '600' },
});
