import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Modal, Pressable, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  sortConversations, sortProjects,
  type DemoConversation, type DemoProject,
} from '../demo/conversations';
import type { VisualTokens } from './visual-tokens';

type ItemMenu = { kind: 'project' | 'conversation' | 'recent-settings'; id: string };
type EditDialog = { kind: 'create-project' | 'rename-project' | 'rename-conversation'; id: string };

/** A board with a pen, rather than a standalone pencil character. */
export function NewChatIcon({ size = 22 }: { size?: number }) {
  return <View accessible={false} style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
    <View style={{ width: size * 0.71, height: size * 0.71, borderWidth: 1.8,
      borderColor: '#fff', borderRadius: 3, marginTop: size * 0.15, marginRight: size * 0.15 }} />
    <View style={{ position: 'absolute', top: size * 0.12, right: size * 0.05,
      width: size * 0.62, height: 3, borderRadius: 2, backgroundColor: '#fff',
      transform: [{ rotate: '-45deg' }] }} />
  </View>;
}

type Props = {
  visual: VisualTokens;
  visible: boolean;
  selectedId: string;
  selectedHostId: string | null;
  conversations: readonly DemoConversation[];
  projects: readonly DemoProject[];
  includeProjectConversations: boolean;
  onIncludeProjectConversations: (value: boolean) => void;
  onClose: () => void;
  onNew: (projectId?: string) => void;
  onChoose: (id: string) => void;
  onAccount: () => void;
  onTasks: () => void;
  onProjectCreate: (name: string) => void;
  onProjectAction: (id: string, action: 'rename' | 'pin' | 'delete', value?: string) => void;
  onProjectRules: (id: string) => void;
  onConversationAction: (id: string, action: 'rename' | 'pin' | 'delete', value?: string) => void;
};

function StateIcon({ item }: { item: DemoConversation }) {
  if (item.running) {
    return <ActivityIndicator accessibilityLabel="进行中" size="small" color="#b4b4b4" style={styles.status} />;
  }
  if (item.unread) {
    return <View style={styles.status} accessibilityLabel="有未读回复">
      <View style={styles.unreadDot} />
    </View>;
  }
  return <View style={styles.status} />;
}

export function ChatSidebar(props: Props) {
  const {
    visual,
    visible, selectedId, selectedHostId, conversations, projects,
    includeProjectConversations, onIncludeProjectConversations, onClose, onNew,
    onChoose, onAccount, onTasks, onProjectCreate, onProjectAction,
    onProjectRules, onConversationAction,
  } = props;
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [openProjects, setOpenProjects] = useState<string[]>([]);
  const [allProjectConversations, setAllProjectConversations] = useState<string[]>([]);
  const [recentLimit, setRecentLimit] = useState(10);
  const [menu, setMenu] = useState<ItemMenu | null>(null);
  const [dialog, setDialog] = useState<EditDialog | null>(null);
  const [dialogText, setDialogText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mounted, setMounted] = useState(visible);
  const drawerProgress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const consumedLongPress = useRef<string | null>(null);

  useEffect(() => {
    if (visible) setMounted(true);
    const animation = Animated.timing(drawerProgress, {
      toValue: visible ? 1 : 0,
      duration: visual.sidebarSlideDurationMs,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => animation.stop();
  }, [visible, drawerProgress, visual.sidebarSlideDurationMs]);

  useEffect(() => { setRecentLimit(10); }, [includeProjectConversations, selectedHostId]);
  useEffect(() => { if (!visible) { setMenu(null); setSearchOpen(false); setSearch(''); } }, [visible]);

  const sortedProjects = useMemo(() =>
    sortProjects(projects).filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())),
  [projects, search]);
  const allRecent = useMemo(() =>
    sortConversations(conversations).filter((c) =>
      (includeProjectConversations || c.projectId === null) &&
      c.title.toLowerCase().includes(search.trim().toLowerCase())),
  [conversations, includeProjectConversations, search]);
  const projectRows = showAllProjects || search ? sortedProjects : sortedProjects.slice(0, 5);
  const recentRows = allRecent.slice(0, recentLimit);
  const toggleProject = (id: string) =>
    setOpenProjects((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  const toggleProjectAll = (id: string) =>
    setAllProjectConversations((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);

  const longPress = (kind: ItemMenu['kind'], id: string) => {
    consumedLongPress.current = `${kind}:${id}`;
    setMenu({ kind, id });
  };
  const clearConsumedPress = (kind: ItemMenu['kind'], id: string) => {
    const token = `${kind}:${id}`;
    if (consumedLongPress.current === token) {
      setTimeout(() => {
        if (consumedLongPress.current === token) consumedLongPress.current = null;
      }, 500);
    }
  };
  const activate = (kind: ItemMenu['kind'], id: string, callback: () => void) => {
    if (consumedLongPress.current === `${kind}:${id}`) {
      consumedLongPress.current = null;
      return;
    }
    callback();
  };
  const edit = (kind: EditDialog['kind'], id: string, value: string) => {
    setMenu(null);
    setDialogText(value);
    setDialog({ kind, id });
  };
  const finishEdit = () => {
    if (!dialog) return;
    const text = dialogText.trim();
    if (dialog.kind === 'create-project') onProjectCreate(text || '新项目');
    if (dialog.kind === 'rename-project' && text) onProjectAction(dialog.id, 'rename', text);
    if (dialog.kind === 'rename-conversation' && text) onConversationAction(dialog.id, 'rename', text);
    setDialog(null);
  };
  const action = (kind: ItemMenu['kind'], id: string, key: string) => {
    setMenu(null);
    if (kind === 'project') {
      if (key === 'new') { onNew(id); return; }
      if (key === 'rules') { onProjectRules(id); return; }
      if (key === 'pin') { onProjectAction(id, 'pin'); return; }
      if (key === 'rename') {
        edit('rename-project', id, projects.find((p) => p.id === id)?.name || '');
        return;
      }
      if (key === 'delete') {
        Alert.alert('删除项目', '项目下的聊天会保留为普通聊天。', [
          { text: '取消', style: 'cancel' },
          { text: '删除', style: 'destructive', onPress: () => onProjectAction(id, 'delete') },
        ]);
      }
    } else if (kind === 'conversation') {
      if (key === 'pin') onConversationAction(id, 'pin');
      if (key === 'rename') edit('rename-conversation', id,
        conversations.find((c) => c.id === id)?.title || '');
      if (key === 'delete') {
        Alert.alert('删除对话', '删除后将无法从视觉版中恢复。', [
          { text: '取消', style: 'cancel' },
          { text: '删除', style: 'destructive', onPress: () => onConversationAction(id, 'delete') },
        ]);
      }
    }
  };

  const conversationRow = (item: DemoConversation, nested: boolean) =>
    <Pressable
      key={item.id}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityState={{ selected: item.id === selectedId }}
      style={[styles.conversationRow, { height: visual.sidebarConversationRowHeight },
        nested && styles.nested, item.id === selectedId && styles.selected]}
      onPress={() => activate('conversation', item.id, () => onChoose(item.id))}
      onLongPress={() => longPress('conversation', item.id)}
      onPressOut={() => clearConsumedPress('conversation', item.id)}
      delayLongPress={450}
    >
      <Text style={styles.conversationName} numberOfLines={1}>{item.title}</Text>
      <StateIcon item={item} />
    </Pressable>;

  return <Modal visible={mounted} transparent animationType="none" statusBarTranslucent onRequestClose={() => menu ? setMenu(null) : onClose()}>
    <View style={styles.overlay}>
      <Animated.View pointerEvents="none" style={[styles.scrim, {
        opacity: drawerProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
      }]} />
      <Pressable accessibilityLabel="关闭侧边栏" style={styles.scrimTouch} onPress={onClose} />
      <Animated.View style={[styles.animatedPanel, {
        width: `${visual.sidebarWidthPercent}%`,
        maxWidth: visual.sidebarMaxWidth,
        transform: [{ translateX: drawerProgress.interpolate({
          inputRange: [0, 1], outputRange: [-Math.max(600, visual.sidebarMaxWidth), 0],
        }) }],
      }]}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.panel}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, {
            paddingTop: visual.sidebarTopHeight + 4,
            paddingBottom: visual.sidebarBottomHeight + 16,
          }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Pressable style={styles.taskRow} onPress={onTasks}>
            <Text style={styles.taskIcon}>◷</Text><Text style={styles.rowText}>定时任务</Text>
          </Pressable>
          <View style={[styles.sectionHead, { minHeight: visual.sidebarSectionHeight }]}>
            <Text style={styles.sectionName}>项目</Text>
            <Pressable accessibilityLabel="新建项目" style={styles.sectionAction}
              onPress={() => edit('create-project', '', '')}><Text style={styles.sectionActionText}>＋</Text></Pressable>
          </View>
          {!sortedProjects.length && <Text style={styles.empty}>暂无项目</Text>}
          {projectRows.map((project) => {
            const opened = openProjects.includes(project.id);
            const children = sortConversations(conversations.filter((c) =>
              c.projectId === project.id && c.title.toLowerCase().includes(search.trim().toLowerCase())));
            const showAll = allProjectConversations.includes(project.id);
            const shownChildren = showAll || search ? children : children.slice(0, 5);
            return <View key={project.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={project.name}
                accessibilityState={{ expanded: opened }}
                style={[styles.projectRow, { minHeight: visual.sidebarProjectRowHeight }]}
                onPress={() => activate('project', project.id, () => toggleProject(project.id))}
                onLongPress={() => longPress('project', project.id)}
                onPressOut={() => clearConsumedPress('project', project.id)}
                delayLongPress={450}
              >
                <Text style={styles.disclosure}>{opened ? '⌄' : '›'}</Text>
                <Text style={styles.folder}>▱</Text>
                <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
                {project.pinned && <Text style={styles.pin}>⌁</Text>}
              </Pressable>
              {opened && <View style={styles.children}>
                {shownChildren.map((item) => conversationRow(item, true))}
                {!children.length && <Pressable onPress={() => onNew(project.id)} style={styles.emptyChild}>
                  <Text style={styles.empty}>＋ 新建项目聊天</Text>
                </Pressable>}
                {children.length > 5 && !search && <Pressable
                  style={styles.moreChild} onPress={() => toggleProjectAll(project.id)}>
                  <Text style={styles.moreText}>{showAll ? '收起对话' : '展开全部对话'}</Text>
                </Pressable>}
              </View>}
            </View>;
          })}
          {sortedProjects.length > 5 && !search && <Pressable
            style={styles.moreRow} onPress={() => setShowAllProjects(!showAllProjects)}>
            <Text style={styles.moreText}>{showAllProjects ? '⌃ 收起项目' : '⌄ 展开全部项目'}</Text>
          </Pressable>}

          <View style={[styles.sectionHead, styles.recentHead, { minHeight: visual.sidebarSectionHeight }]}>
            <Text style={styles.sectionName}>最近对话</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="最近对话设置"
              style={styles.sectionAction} onPress={() => setMenu({ kind: 'recent-settings', id: '' })}>
              <Text style={styles.settingsGlyph}>⚙</Text>
            </Pressable>
          </View>
          {recentRows.map((item) => conversationRow(item, false))}
          {!allRecent.length && <Text style={styles.empty}>暂无对话</Text>}
          {recentLimit < allRecent.length && <Pressable style={styles.moreRow}
            onPress={() => setRecentLimit((n) => n + 10)}>
            <Text style={styles.moreText}>⌄ 加载更多对话</Text>
          </Pressable>}
        </ScrollView>

        <View pointerEvents="box-none" style={[styles.fixedTop, { height: visual.sidebarTopHeight }]}>
          <View pointerEvents="none" style={styles.topFadeLight} />
          <View style={styles.topBar}>
            {searchOpen ? <>
              <TextInput autoFocus value={search} onChangeText={setSearch}
                placeholder="搜索项目或对话" placeholderTextColor="#9d9d9d"
                style={styles.searchField} />
              <Pressable accessibilityLabel="关闭搜索" onPress={() => { setSearchOpen(false); setSearch(''); }}>
                <Text style={styles.topSymbol}>×</Text>
              </Pressable>
            </> : <>
              <Text style={styles.appName}>CodexMobile</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="搜索"
                onPress={() => setSearchOpen(true)} style={styles.topButton}>
                <Text style={styles.topSymbol}>⌕</Text>
              </Pressable>
            </>}
          </View>
        </View>
        <View pointerEvents="box-none" style={[styles.fixedBottom, { height: visual.sidebarBottomHeight }]}>
          <View pointerEvents="none" style={styles.bottomFadeLight} />
          <View style={styles.bottomBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="新建聊天"
              style={[styles.newChat, { height: visual.newChatHeight }]} onPress={() => onNew()}>
              <NewChatIcon size={visual.newChatIconSize} /><Text style={styles.newText}>聊天</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="电脑与全局规则"
              style={styles.profile} onPress={onAccount}>
              <Text style={styles.avatarGlyph}>◉</Text>
            </Pressable>
          </View>
        </View>
        {menu && <View style={styles.modalLayer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} />
          <View style={styles.contextMenu}>
            {menu.kind === 'recent-settings'
              ? <Pressable style={styles.menuItem} onPress={() => {
                onIncludeProjectConversations(!includeProjectConversations);
                setMenu(null);
              }}>
                <Text style={styles.menuGlyph}>{includeProjectConversations ? '☑' : '☐'}</Text>
                <Text style={styles.menuText}>包含项目内对话</Text>
              </Pressable>
              : (menu.kind === 'project'
                ? [
                  ['new', '新建项目聊天'], ['pin', projects.find((p) => p.id === menu.id)?.pinned ? '取消置顶' : '置顶项目'],
                  ['rename', '重命名项目'], ['rules', '项目规则'], ['delete', '删除项目'],
                ] : [
                  ['rename', '重命名对话'],
                  ['pin', conversations.find((c) => c.id === menu.id)?.pinned ? '取消置顶' : '置顶对话'],
                  ['delete', '删除对话'],
                ]).map(([key, label]) => <Pressable key={key} style={styles.menuItem}
                  onPress={() => action(menu.kind, menu.id, key)}>
                  <Text style={[styles.menuText, key === 'delete' && styles.danger]}>{label}</Text>
                </Pressable>)}
          </View>
        </View>}
        {dialog && <View style={styles.modalLayer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDialog(null)} />
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{dialog.kind === 'create-project' ? '新建项目' : '重命名'}</Text>
            <TextInput autoFocus value={dialogText} onChangeText={setDialogText}
              onSubmitEditing={finishEdit} placeholder="名称" placeholderTextColor="#888"
              style={styles.dialogField} />
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setDialog(null)}><Text style={styles.dialogAction}>取消</Text></Pressable>
              <Pressable onPress={finishEdit}><Text style={[styles.dialogAction, styles.confirm]}>确定</Text></Pressable>
            </View>
          </View>
        </View>}
      </SafeAreaView>
      </Animated.View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: 'row' },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#00000099' },
  scrimTouch: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  animatedPanel: { width: '84%', maxWidth: 370, flex: 1 },
  panel: { flex: 1, backgroundColor: '#212121' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 12, paddingTop: 122, paddingBottom: 136 },
  taskRow: { minHeight: 49, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 12 },
  taskIcon: { color: '#dddddd', fontSize: 25 },
  rowText: { color: '#eee', fontSize: 15 },
  sectionHead: { minHeight: 45, flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 6, marginTop: 10 },
  recentHead: { marginTop: 15 },
  sectionName: { color: '#eaeaea', fontSize: 14, fontWeight: '600' },
  sectionAction: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },
  sectionActionText: { fontSize: 25, color: '#dedede' },
  settingsGlyph: { color: '#d0d0d0', fontSize: 21 },
  projectRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, borderRadius: 12, gap: 9 },
  disclosure: { color: '#9e9e9e', fontSize: 23, width: 14, textAlign: 'center' },
  folder: { color: '#b8b8b8', fontSize: 23, width: 22 },
  projectName: { color: '#e6e6e6', fontSize: 14, flex: 1 },
  pin: { color: '#a0a0a0' },
  children: { marginLeft: 19 },
  conversationRow: { height: 39, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 7, borderRadius: 10 },
  nested: { paddingLeft: 24 },
  selected: { backgroundColor: '#383838' },
  conversationName: { flex: 1, color: '#dcdcdc', fontSize: 14 },
  status: { width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#5897f9' },
  empty: { color: '#999', fontSize: 13, paddingHorizontal: 20, paddingVertical: 12 },
  emptyChild: { paddingLeft: 11 },
  moreRow: { minHeight: 40, justifyContent: 'center', paddingLeft: 20 },
  moreChild: { minHeight: 35, justifyContent: 'center', paddingLeft: 23 },
  moreText: { color: '#acacac', fontSize: 13 },
  fixedTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 85, backgroundColor: '#212121f1' },
  topFadeLight: { backgroundColor: '#21212188', position: 'absolute', bottom: -13, height: 13, left: 0, right: 0 },
  topBar: { flex: 1, paddingTop: 46, paddingHorizontal: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  appName: { color: '#fff', fontSize: 21, fontWeight: '600' },
  topButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#303030', borderWidth: 1, borderColor: '#4a4a4a', alignItems: 'center', justifyContent: 'center' },
  topSymbol: { color: '#f3f3f3', fontSize: 26 },
  searchField: { color: '#fff', flex: 1, fontSize: 16 },
  fixedBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 86, backgroundColor: '#212121e9' },
  bottomFadeLight: { backgroundColor: '#21212199', position: 'absolute', top: -12, height: 12, left: 0, right: 0 },
  bottomBar: { height: '100%', paddingLeft: 30, paddingRight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  newChat: { height: 54, paddingHorizontal: 24, borderRadius: 28, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#236ae2' },
  newSymbol: { color: '#fff', fontSize: 23 },
  newText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  profile: { height: 55, width: 55, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#55565b' },
  avatarGlyph: { fontSize: 31, color: '#f5f5f5' },
  modalLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000099', padding: 20 },
  contextMenu: { width: '100%', maxWidth: 290, backgroundColor: '#343434', borderRadius: 18, paddingVertical: 8 },
  menuItem: { minHeight: 48, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', gap: 14 },
  menuGlyph: { color: '#f4f4f4', fontSize: 21 },
  menuText: { color: '#f4f4f4', fontSize: 15 },
  danger: { color: '#ff6464' },
  dialog: { width: '100%', maxWidth: 290, borderRadius: 19, padding: 20, backgroundColor: '#343434' },
  dialogTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 14 },
  dialogField: { height: 46, borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#252525', color: '#fff' },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 28, paddingTop: 23 },
  dialogAction: { color: '#d0d0d0', fontSize: 15 },
  confirm: { color: '#80aaff', fontWeight: '600' },
});
