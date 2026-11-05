/** The visual edition owns only local demonstration data; it never calls Codex. */
export const CONNECT_PROMPT = '请点击左上角菜单-下方头像连接电脑';

export type DemoMessage = { id: string; role: 'user' | 'assistant'; text: string };
export type DemoConversation = {
  id: string;
  title: string;
  seeded: boolean;
  draft: string;
  messages: DemoMessage[];
  projectId: string | null;
  updatedAt: number;
  pinned: boolean;
  running: boolean;
  unread: boolean;
};
export type DemoProject = {
  id: string;
  name: string;
  rules: string;
  pinned: boolean;
  updatedAt: number;
};
export type DemoHost = { id: string; name: string; demo: true };
export type DemoState = {
  selectedId: string;
  selectedHostId: string | null;
  nextId: number;
  conversations: DemoConversation[];
  projects: DemoProject[];
  hosts: DemoHost[];
  globalRules: string;
  includeProjectConversations: boolean;
};
export type DemoAction =
  | { type: 'hydrate'; state: DemoState }
  | { type: 'new'; projectId?: string | null }
  | { type: 'select'; id: string }
  | { type: 'read'; id: string }
  | { type: 'draft'; text: string }
  | { type: 'send' }
  | { type: 'reply'; id: string; visible: boolean }
  | { type: 'conversation-rename'; id: string; title: string }
  | { type: 'conversation-pin'; id: string }
  | { type: 'conversation-delete'; id: string }
  | { type: 'project-create'; name: string }
  | { type: 'project-rename'; id: string; name: string }
  | { type: 'project-pin'; id: string }
  | { type: 'project-delete'; id: string }
  | { type: 'project-rules'; id: string; text: string }
  | { type: 'global-rules'; text: string }
  | { type: 'host-add'; name: string }
  | { type: 'host-rename'; id: string; name: string }
  | { type: 'host-remove'; id: string }
  | { type: 'host-select'; id: string }
  | { type: 'include-project-conversations'; value: boolean };

const seedProjects: DemoProject[] = [
  '视觉界面', '项目演示', '移动端测试', '语音输入', '本地规则', '第六个项目',
].map((name, index) => ({
  id: `project-${index + 1}`, name, rules: '', pinned: false,
  updatedAt: 100 - index,
}));

export const initialDemoState: DemoState = {
  selectedId: 'test-1',
  selectedHostId: null,
  nextId: 1,
  conversations: [1, 2, 3].map((n) => ({
    id: `test-${n}`, title: `测试聊天 ${n}`, seeded: true,
    draft: '', messages: [], projectId: n === 1 ? 'project-1' : null,
    updatedAt: 100 - n, pinned: false, running: false, unread: false,
  })),
  projects: seedProjects,
  hosts: [],
  globalRules: '',
  includeProjectConversations: true,
};

function changeConversation(state: DemoState, id: string, fn: (item: DemoConversation) => DemoConversation): DemoState {
  return { ...state, conversations: state.conversations.map((item) => item.id === id ? fn(item) : item) };
}

function tick(state: DemoState): number { return 200 + state.nextId; }

/** All updates are immutable; the same conversation ID is shared by every sidebar view. */
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'hydrate':
      return action.state?.conversations?.length && action.state?.projects && Array.isArray(action.state.hosts)
        ? { ...action.state, conversations: action.state.conversations.map((c) =>
          c.running ? { ...c, running: false, unread: true, messages: [
            ...c.messages, { id: `restored-${c.id}`, role: 'assistant' as const, text: CONNECT_PROMPT },
          ] } : c) }
        : state;
    case 'new': {
      const id = `local-${state.nextId}`;
      const projectId = state.projects.some((p) => p.id === action.projectId) ? action.projectId! : null;
      return {
        ...state, selectedId: id, nextId: state.nextId + 1,
        conversations: [{ id, title: '新聊天', seeded: false, draft: '', messages: [],
          projectId, updatedAt: tick(state), pinned: false, running: false, unread: false }, ...state.conversations],
      };
    }
    case 'select':
      return state.conversations.some((c) => c.id === action.id)
        ? { ...state, selectedId: action.id, conversations: state.conversations.map((c) =>
          c.id === action.id ? { ...c, unread: false } : c) } : state;
    case 'read':
      return changeConversation(state, action.id, (c) => c.unread ? { ...c, unread: false } : c);
    case 'draft':
      return changeConversation(state, state.selectedId, (c) => ({ ...c, draft: action.text }));
    case 'send': {
      const current = state.conversations.find((c) => c.id === state.selectedId);
      const text = current?.draft.trim();
      if (!current || !text || current.running) return state;
      const messageId = state.nextId;
      const result = {
        ...changeConversation(state, current.id, (c) => ({
          ...c, draft: '', running: true, unread: false, updatedAt: tick(state),
          title: !c.seeded && c.messages.length === 0 ? text.slice(0, 28) : c.title,
          messages: [...c.messages, { id: `user-${messageId}`, role: 'user', text }],
        })),
        nextId: messageId + 1,
      };
      return { ...result, projects: result.projects.map((p) =>
        p.id === current.projectId ? { ...p, updatedAt: tick(state) } : p) };
    }
    case 'reply': {
      const current = state.conversations.find((c) => c.id === action.id);
      if (!current?.running) return state;
      const output = changeConversation(state, action.id, (c) => ({
        ...c, running: false, unread: !action.visible, updatedAt: tick(state),
        messages: [...c.messages, { id: `assistant-${state.nextId}`, role: 'assistant', text: CONNECT_PROMPT }],
      }));
      return { ...output, nextId: state.nextId + 1,
        projects: output.projects.map((p) =>
          p.id === current.projectId ? { ...p, updatedAt: tick(state) } : p) };
    }
    case 'conversation-rename':
      return changeConversation(state, action.id, (c) => ({ ...c, title: action.title.trim() || c.title }));
    case 'conversation-pin':
      return changeConversation(state, action.id, (c) => ({ ...c, pinned: !c.pinned }));
    case 'conversation-delete': {
      const conversations = state.conversations.filter((c) => c.id !== action.id);
      if (conversations.length === state.conversations.length) return state;
      if (!conversations.length) {
        const id = `local-${state.nextId}`;
        return { ...state, selectedId: id, nextId: state.nextId + 1,
          conversations: [{ id, title: '新聊天', seeded: false, draft: '', messages: [],
            projectId: null, updatedAt: tick(state), pinned: false, running: false, unread: false }] };
      }
      return { ...state, conversations,
        selectedId: state.selectedId === action.id ? conversations[0].id : state.selectedId };
    }
    case 'project-create': {
      const id = `project-local-${state.nextId}`;
      return { ...state, nextId: state.nextId + 1,
        projects: [{ id, name: action.name.trim() || '新项目', rules: '', pinned: false, updatedAt: tick(state) }, ...state.projects] };
    }
    case 'project-rename':
      return { ...state, projects: state.projects.map((p) => p.id === action.id
        ? { ...p, name: action.name.trim() || p.name } : p) };
    case 'project-pin':
      return { ...state, projects: state.projects.map((p) =>
        p.id === action.id ? { ...p, pinned: !p.pinned } : p) };
    case 'project-rules':
      return { ...state, projects: state.projects.map((p) =>
        p.id === action.id ? { ...p, rules: action.text } : p) };
    case 'project-delete':
      return { ...state, projects: state.projects.filter((p) => p.id !== action.id),
        conversations: state.conversations.map((c) => c.projectId === action.id
          ? { ...c, projectId: null } : c) };
    case 'global-rules':
      return { ...state, globalRules: action.text };
    case 'host-add': {
      const id = `demo-host-${state.nextId}`;
      return { ...state, nextId: state.nextId + 1, selectedHostId: id,
        hosts: [...state.hosts, { id, name: action.name.trim() || '演示电脑', demo: true }] };
    }
    case 'host-rename':
      return { ...state, hosts: state.hosts.map((h) =>
        h.id === action.id ? { ...h, name: action.name.trim() || h.name } : h) };
    case 'host-remove': {
      const hosts = state.hosts.filter((h) => h.id !== action.id);
      return { ...state, hosts, selectedHostId: state.selectedHostId === action.id ? null : state.selectedHostId };
    }
    case 'host-select':
      return state.hosts.some((h) => h.id === action.id) ? { ...state, selectedHostId: action.id } : state;
    case 'include-project-conversations':
      return { ...state, includeProjectConversations: action.value };
  }
}

export const sortConversations = (items: readonly DemoConversation[]) =>
  [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
export const sortProjects = (items: readonly DemoProject[]) =>
  [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
