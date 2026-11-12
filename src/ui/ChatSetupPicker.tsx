import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DemoHost, DemoProject } from '../demo/conversations';
import { ReferenceIcon } from './ReferenceIcons';

type Props = {
  hosts: readonly DemoHost[];
  projects: readonly DemoProject[];
  hostId: string | null;
  projectId: string | null;
  onChooseHost: (id: string | null) => void;
  onChooseProject: (id: string | null) => void;
  onAddHost: (name: string) => void;
};

/** New-chat machine/project placement is local-only until a real Codex host is connected. */
export function ChatSetupPicker({ hosts, projects, hostId, projectId,
  onChooseHost, onChooseProject, onAddHost }: Props) {
  const [picker, setPicker] = useState<'host' | 'project' | null>(null);
  const [newHostName, setNewHostName] = useState('');
  const hostName = hosts.find((host) => host.id === hostId)?.name ?? '未选择机器';
  const projectName = projects.find((project) => project.id === projectId)?.name ?? '无项目';
  const close = () => { setPicker(null); setNewHostName(''); };
  const chooseHost = (id: string | null) => { onChooseHost(id); close(); };
  const chooseProject = (id: string | null) => { onChooseProject(id); close(); };

  return <>
    <View style={styles.bar}>
      <Pressable accessibilityRole="button" accessibilityLabel="选择机器"
        style={styles.choice} onPress={() => setPicker('host')}>
        <ReferenceIcon name="computer" size={20} color="#bbb" />
        <Text numberOfLines={1} style={styles.choiceText}>{hostName}</Text>
        <ReferenceIcon name="chevron-down" size={16} color="#c0c0c0" />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="选择项目"
        style={styles.choice} onPress={() => setPicker('project')}>
        <ReferenceIcon name="folder" size={20} color="#bbb" />
        <Text numberOfLines={1} style={styles.choiceText}>{projectName}</Text>
        <ReferenceIcon name="chevron-down" size={16} color="#c0c0c0" />
      </Pressable>
    </View>
    <Modal transparent statusBarTranslucent animationType="fade" visible={picker !== null}
      onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="取消选择" onPress={close} style={StyleSheet.absoluteFill} />
        <View style={styles.dialog}>
          <Text style={styles.heading}>{picker === 'host' ? '选择机器' : '选择项目'}</Text>
          <ScrollView style={styles.items} keyboardShouldPersistTaps="handled">
            {picker === 'host' ? <>
              <Pressable style={styles.item} onPress={() => chooseHost(null)}>
                <ReferenceIcon name="computer" size={24} color="#ddd" />
                <Text style={styles.itemText}>未选择机器</Text>
                {hostId === null && <ReferenceIcon name="check" size={21} color="#86a9ff" />}
              </Pressable>
              {hosts.map((host) => <Pressable key={host.id} style={styles.item}
                onPress={() => chooseHost(host.id)}>
                <ReferenceIcon name="computer" size={24} color="#ddd" />
                <Text style={styles.itemText} numberOfLines={1}>{host.name}</Text>
                {hostId === host.id && <ReferenceIcon name="check" size={21} color="#86a9ff" />}
              </Pressable>)}
              <View style={styles.createRow}>
                <TextInput accessibilityLabel="演示机器名称" placeholder="添加演示机器名称"
                  placeholderTextColor="#999" value={newHostName} onChangeText={setNewHostName}
                  maxLength={60} style={styles.createInput} />
                <Pressable accessibilityLabel="添加演示机器" style={styles.addButton}
                  disabled={!newHostName.trim()} onPress={() => { onAddHost(newHostName.trim()); close(); }}>
                  <ReferenceIcon name="plus" size={22} color={newHostName.trim() ? '#fff' : '#777'} />
                </Pressable>
              </View>
              <Text style={styles.note}>仅配置本地视觉演示机器，不会连接真实电脑。</Text>
            </> : <>
              <Pressable style={styles.item} onPress={() => chooseProject(null)}>
                <ReferenceIcon name="computer" size={24} color="#ddd" />
                <Text style={styles.itemText}>无项目</Text>
                {projectId === null && <ReferenceIcon name="check" size={21} color="#86a9ff" />}
              </Pressable>
              {projects.map((project) => <Pressable key={project.id} style={styles.item}
                onPress={() => chooseProject(project.id)}>
                <ReferenceIcon name="folder" size={24} color="#ddd" />
                <Text style={styles.itemText} numberOfLines={1}>{project.name}</Text>
                {projectId === project.id && <ReferenceIcon name="check" size={21} color="#86a9ff" />}
              </Pressable>)}
            </>}
          </ScrollView>
          <Pressable accessibilityLabel="取消" onPress={close} style={styles.cancel}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 23, paddingVertical: 10, gap: 8 },
  choice: { alignSelf: 'flex-start', maxWidth: '94%', minHeight: 34,
    flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceText: { color: '#d4d4d4', fontSize: 16, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: '#0000009c', justifyContent: 'center', paddingHorizontal: 20 },
  dialog: { backgroundColor: '#303030', borderRadius: 22, maxHeight: '77%', overflow: 'hidden', paddingTop: 20 },
  heading: { color: '#aeaeae', fontSize: 16, paddingHorizontal: 25, marginBottom: 10 },
  items: { flexGrow: 0 },
  item: { minHeight: 61, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 17 },
  itemText: { color: '#f1f1f1', fontSize: 17, flex: 1 },
  createRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 12,
    borderWidth: 1, borderColor: '#565656', borderRadius: 14, paddingLeft: 12 },
  createInput: { flex: 1, minHeight: 48, fontSize: 16, color: '#fff' },
  addButton: { height: 48, width: 48, alignItems: 'center', justifyContent: 'center' },
  note: { color: '#a4a4a4', fontSize: 12, lineHeight: 18, marginHorizontal: 23, marginTop: 10 },
  cancel: { minHeight: 57, justifyContent: 'center', paddingHorizontal: 25, borderTopWidth: 1,
    borderTopColor: '#494949', marginTop: 17 },
  cancelText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
