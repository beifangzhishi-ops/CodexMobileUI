import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime,
  type AppendMessage, type ThreadMessageLike,
} from '@assistant-ui/react-native';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { ChatConversation, ChatHost, ChatProject } from './chatModels';
import type { VisualTokens } from './visual-tokens';
import { ReferenceIcon } from './ReferenceIcons';
import { ChatSetupPicker } from './ChatSetupPicker';
import type { AvailableModel } from '../session/useCodexSession';
import type { TurnSettings } from '../session/firstSend';

const effortLabels: Record<string,string> = { minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: 'Max', ultra: 'Ultra' };
const thinkingLevels = Object.keys(effortLabels);
const speeds = ['常规', '快速'] as const;
const permissions = [
  { name: '默认权限', description: '在沙盒中运行命令' },
  { name: '自动审查', description: '自动处理可安全批准的请求' },
  { name: '只读', description: '修改文件或运行命令需要批准' },
  { name: '完整访问权限', description: '只能由电脑端授予，手机不能直接启用' },
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

export function ChatView({ conversation, onDraft, onSend, visual, searchOpen, onSearchClose,
  hosts, projects, hostId, onChooseHost, onChooseProject, onAddHost, online, availableModels }: {
  conversation: ChatConversation;
  onDraft: (text: string) => void;
  onSend: (settings: TurnSettings) => void;
  online: boolean;
  availableModels: readonly AvailableModel[];
  visual: VisualTokens;
  searchOpen: boolean;
  onSearchClose: () => void;
  hosts: readonly ChatHost[];
  projects: readonly ChatProject[];
  hostId: string | null;
  onChooseHost: (id: string | null) => void;
  onChooseProject: (id: string | null) => void;
  onAddHost: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedEffort, setSelectedEffort] = useState('');
  const [selectedSpeed, setSelectedSpeed] = useState<(typeof speeds)[number]>('常规');
  const [selectedPermission, setSelectedPermission] = useState(permissions[0].name);
  const selectedCatalogModel = availableModels.find((model) => model.id === selectedModel);
  const effectiveModel = selectedCatalogModel ?? availableModels.find((model) => model.isDefault) ?? availableModels[0];
  const availableEfforts = effectiveModel?.efforts.length
    ? thinkingLevels.filter((value) => effectiveModel.efforts.includes(value)) : [];
  const settingsForTurn = (): TurnSettings => ({
    ...(effectiveModel ? { model: effectiveModel.id } : {}),
    ...(selectedEffort && availableEfforts.includes(selectedEffort) ? { effort: selectedEffort } : {}),
    ...(selectedSpeed === '快速' ? { serviceTierForTurn: 'fast' as const } : {}),
  });
  const [panel, setPanel] = useState<'model' | 'effort' | 'speed' | 'permission' | null>(null);
  const [closingPanel, setClosingPanel] = useState<typeof panel>(null);
  const panelProgress = useRef(new Animated.Value(0)).current;
  const composerRise = useRef(new Animated.Value(0)).current;
  const [voiceMode, setVoiceMode] = useState<'idle' | 'recording' | 'review'>('idle');
  const [transcript, setTranscript] = useState('');
  const [volume, setVolume] = useState(1);
  const [speechError, setSpeechError] = useState('');
  const cancelled = useRef(false);
  const microphoneActive = useRef(false);

  useEffect(() => {
    if (panel) setClosingPanel(panel);
    const animation = Animated.timing(panelProgress, {
      toValue: panel ? 1 : 0,
      duration: panel ? 205 : 145,
      easing: panel ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (finished && !panel) setClosingPanel(null);
    });
    return () => animation.stop();
  }, [Boolean(panel), panelProgress]);

  const liftComposerOnFocus = () => {
    setPanel(null);
    composerRise.stopAnimation();
    composerRise.setValue(12);
    Animated.spring(composerRise, {
      toValue: 0, tension: 130, friction: 15,
      useNativeDriver: true, isInteraction: false,
    }).start();
  };

  const displayedPanel = panel ?? closingPanel;

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

  const matchingMessages = useMemo(() => searchOpen && searchQuery.trim()
    ? conversation.messages.filter((message) =>
        message.text.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()))
    : conversation.messages, [conversation.messages, searchOpen, searchQuery]);
  useEffect(() => { setSearchQuery(''); }, [conversation.id, searchOpen]);
  const messages = useMemo<ThreadMessageLike[]>(() => matchingMessages.map((message) => ({
    id: message.id, role: message.role, content: [{ type: 'text' as const, text: message.text }],
  })), [matchingMessages]);
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message: ThreadMessageLike) => message,
    onNew: async (_message: AppendMessage) => { if (online) onSend(settingsForTurn()); },
    isRunning: conversation.running,
  });

  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root style={styles.thread}>
      {searchOpen && <View style={styles.chatSearchBar}>
        <ReferenceIcon name="search" size={20} color="#ddd" />
        <TextInput accessibilityLabel="在聊天中查找" autoFocus
          value={searchQuery} onChangeText={setSearchQuery}
          placeholder="查找对话内容" placeholderTextColor="#999"
          style={styles.chatSearchInput} />
        <Text style={styles.matchCount}>{searchQuery.trim() ? `${matchingMessages.length} 条` : ''}</Text>
        <Pressable accessibilityLabel="关闭聊天查找" onPress={onSearchClose}>
          <ReferenceIcon name="close" size={21} color="#ddd" />
        </Pressable>
      </View>}
      <ThreadPrimitive.MessagesFlatList
        key={conversation.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        autoScroll
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<View style={styles.empty}>
          {searchOpen && searchQuery.trim()
            ? <Text style={styles.caption}>未找到匹配消息</Text>
            : <><Text style={styles.greeting}>有什么可以帮忙的？</Text>
              <Text style={styles.caption}>通过已授权的 Codex 电脑发送真实消息</Text></>}
        </View>}
      >
        {({ message }) => <Bubble role={message.role === 'user' ? 'user' : 'assistant'} />}
      </ThreadPrimitive.MessagesFlatList>
      {conversation.messages.length === 0 && !searchOpen && <ChatSetupPicker
        hosts={hosts} projects={projects} hostId={hostId} projectId={conversation.projectId}
        onChooseHost={onChooseHost} onChooseProject={onChooseProject} onAddHost={onAddHost} />}
      <Animated.View style={[styles.composerArea, { transform: [{ translateY: composerRise }] }]}>
        {displayedPanel && <Animated.View pointerEvents={panel ? 'auto' : 'none'}
          style={[styles.floatingMenu, {
            opacity: panelProgress,
            transform: [
              { translateY: panelProgress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              { scale: panelProgress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
            ],
          }]}>
          <ScrollView style={styles.floatingScroll} keyboardShouldPersistTaps="handled">
            {displayedPanel === 'effort' && <>
              <Text style={styles.menuHeading}>思考强度</Text>
              {availableEfforts.map((item) => <Pressable key={item} style={styles.modelItem}
                accessibilityLabel={`思考强度${item}`}
                onPress={() => { setSelectedEffort(item); setPanel(null); }}>
                <Text style={styles.modelText}>{effortLabels[item] ?? item}</Text>
                {selectedEffort === item && <ReferenceIcon name="check" size={22} />}
              </Pressable>)}
              <View style={styles.menuDivider} />
              <Pressable style={styles.menuSubmenu} onPress={() => setPanel('model')}>
                <View style={styles.menuDetail}><Text style={styles.modelText}>模型</Text>
                  <Text style={styles.menuSubtitle}>{effectiveModel?.name ?? '电脑默认模型'}</Text></View>
                <ReferenceIcon name="chevron-right" size={20} />
              </Pressable>
              <Pressable style={styles.menuSubmenu} onPress={() => setPanel('speed')}>
                <View style={styles.menuDetail}><Text style={styles.modelText}>速度</Text>
                  <Text style={styles.menuSubtitle}>{selectedSpeed}</Text></View>
                <ReferenceIcon name="chevron-right" size={20} />
              </Pressable>
            </>}
            {displayedPanel === 'speed' && <>
              <Pressable style={styles.menuBack} onPress={() => setPanel('effort')}>
                <ReferenceIcon name="chevron-left" size={16} color="#bbb" />
                <Text style={styles.menuBackText}>返回思考强度</Text>
              </Pressable>
              {speeds.map((item) => <Pressable key={item} style={styles.modelItem}
                onPress={() => { setSelectedSpeed(item); setPanel('effort'); }}>
                <Text style={styles.modelText}>{item}</Text>
                {selectedSpeed === item && <ReferenceIcon name="check" size={20} />}
              </Pressable>)}
            </>}
            {displayedPanel === 'model' && <Pressable style={styles.menuBack} onPress={() => setPanel('effort')}>
              <ReferenceIcon name="chevron-left" size={16} color="#bbb" />
              <Text style={styles.menuBackText}>返回思考强度</Text>
            </Pressable>}
            {displayedPanel === 'model' && availableModels.map((item) => <Pressable key={item.id} style={styles.modelItem}
                  onPress={() => { setSelectedModel(item.id); setSelectedEffort(''); setPanel('effort'); }}>
                  <Text style={styles.modelText}>{item.name}</Text>
                   {selectedModel === item.id && <ReferenceIcon name="check" size={20} />}
                </Pressable>)}
            {displayedPanel === 'permission' && permissions.map((item, index) => <Pressable key={item.name} style={styles.permissionItem}
                  onPress={() => { if (index > 0) Alert.alert('权限由电脑端管理', '当前 Gateway 不允许手机客户端改变审批或沙箱权限，请在电脑端使用原生授权流程。'); else setSelectedPermission(item.name); setPanel(null); }}>
                  <ReferenceIcon name={(['hand', 'shield-check', 'shield-lock', 'warning'] as const)[index]}
                    size={24} color={index === 3 ? '#ce922f' : '#fff'} />
                  <View style={styles.permissionCopy}>
                    <Text style={styles.modelText}>{item.name}</Text>
                    <Text style={styles.permissionDescription}>{item.description}</Text>
                  </View>
                  {selectedPermission === item.name && <ReferenceIcon name="check" size={20} />}
                </Pressable>)}
          </ScrollView>
        </Animated.View>}
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
                onFocus={liftComposerOnFocus}
              editable={!conversation.running}
            />
            <View style={[styles.toolbar, { height: visual.composerToolbarHeight }]}>
              <Pressable accessibilityLabel="添加附件（未接入）" style={styles.toolButton}
                onPress={() => Alert.alert('附件', '当前客户端暂未开放附件上传。')}>
                <ReferenceIcon name="plus" size={24} color="#e7e7e7" />
              </Pressable>
              <Pressable accessibilityLabel="选择审批权限" style={styles.toolButton}
                onPress={() => setPanel(panel === 'permission' ? null : 'permission')}>
                <ReferenceIcon name={(['hand', 'shield-check', 'shield-lock', 'warning'] as const)[
                  Math.max(0, permissions.findIndex((item) => item.name === selectedPermission))]}
                  size={23} color="#e7e7e7" />
              </Pressable>
              <Pressable accessibilityLabel="选择模型和思考强度" style={styles.modelButton}
                onPress={() => setPanel(panel === 'effort' ? null : 'effort')}>
                <Text style={styles.modelLabel}>{effectiveModel?.name ?? '选择模型'} {effortLabels[selectedEffort] ?? '默认'} ▾</Text>
              </Pressable>
              <View style={styles.spacer} />
              <Pressable accessibilityLabel="语音听写" style={styles.toolButton} onPress={() => { void startSpeech(); }}>
                <ReferenceIcon name="mic" size={24} color="#fff" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={conversation.draft.trim() ? '发送消息' : '实时语音对话（未接入）'}
                onPress={() => conversation.draft.trim() ? onSend(settingsForTurn())
                  : Alert.alert('实时语音对话', '目前未接入实时语音对话，请点击麦克风使用系统语音识别。')}
                disabled={conversation.running}
                style={[styles.blueButton, conversation.running && styles.disabled]}>
                {conversation.running ? <ActivityIndicator size="small" color="#fff" /> :
                  <ReferenceIcon name={conversation.draft.trim() ? 'arrow-up' : 'wave'} size={23} color="#fff" strokeWidth={2.4} />}
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
      </Animated.View>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}

const styles = StyleSheet.create({
  thread: { flex: 1, backgroundColor: '#000' },
  chatSearchBar: { marginHorizontal: 17, marginTop: 10, minHeight: 48, borderRadius: 14,
    paddingHorizontal: 12, backgroundColor: '#292929', flexDirection: 'row', gap: 10, alignItems: 'center' },
  chatSearchInput: { flex: 1, color: '#fff', fontSize: 16, paddingVertical: 8 },
  matchCount: { color: '#a5a5a5', fontSize: 12 },
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
  modelButton: { minHeight: 38, paddingHorizontal: 6, justifyContent: 'center' },
  modelLabel: { color: '#cecece', fontSize: 13 },
  spacer: { flex: 1 },
  blueButton: { height: 38, width: 38, borderRadius: 20, backgroundColor: '#3479e8', justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: 0.6 },
  floatingMenu: { position: 'absolute', bottom: 119, left: 18, right: 18, zIndex: 6,
    borderRadius: 20, backgroundColor: '#303030', overflow: 'hidden', maxHeight: 490 },
  floatingScroll: { flexGrow: 0 },
  menuHeading: { color: '#a9a9a9', fontSize: 14, paddingHorizontal: 19, paddingTop: 20, paddingBottom: 8 },
  menuDivider: { height: 1, backgroundColor: '#484848', marginHorizontal: 19, marginTop: 8 },
  menuSubmenu: { minHeight: 66, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuDetail: { gap: 4 },
  menuSubtitle: { color: '#a0a0a0', fontSize: 13 },
  menuBack: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 19 },
  menuBackText: { fontSize: 13, color: '#d2d2d2' },
  modelItem: { minHeight: 49, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modelText: { color: '#f0f0f0', fontSize: 15 },
  permissionItem: { minHeight: 64, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 12 },
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
