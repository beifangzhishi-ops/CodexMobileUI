export type DemoMessage = { id: string; role: 'user' | 'assistant'; text: string };
export type DemoConversation = {
  id: string;
  title: string;
  seeded: boolean;
  draft: string;
  messages: DemoMessage[];
};
export type DemoState = { selectedId: string; nextId: number; conversations: DemoConversation[] };
export type DemoAction =
  | { type: 'new' }
  | { type: 'select'; id: string }
  | { type: 'draft'; text: string }
  | { type: 'send' };

export const initialDemoState: DemoState = {
  selectedId: 'test-1',
  nextId: 1,
  conversations: [1, 2, 3].map((n) => ({
    id: `test-${n}`, title: `测试聊天 ${n}`, seeded: true, draft: '', messages: [],
  })),
};

// Demo is deliberately memory-only and never uses the real Codex thread/store APIs.
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'new': {
      const id = `local-${state.nextId}`;
      return {
        selectedId: id,
        nextId: state.nextId + 1,
        conversations: [
          { id, title: '新聊天', seeded: false, draft: '', messages: [] },
          ...state.conversations,
        ],
      };
    }
    case 'select':
      return state.conversations.some((conversation) => conversation.id === action.id)
        ? { ...state, selectedId: action.id } : state;
    case 'draft':
      return {
        ...state,
        conversations: state.conversations.map((conversation) =>
          conversation.id === state.selectedId ? { ...conversation, draft: action.text } : conversation),
      };
    case 'send': {
      const current = state.conversations.find((conversation) => conversation.id === state.selectedId);
      const text = current?.draft.trim();
      if (!current || !text) return state;
      const id = state.nextId;
      return {
        ...state,
        nextId: id + 1,
        conversations: state.conversations.map((conversation) => conversation.id === state.selectedId ? {
          ...conversation,
          draft: '',
          title: !conversation.seeded && conversation.messages.length === 0 ? text.slice(0, 26) : conversation.title,
          messages: [
            ...conversation.messages,
            { id: `user-${id}`, role: 'user' as const, text },
            { id: `assistant-${id}`, role: 'assistant' as const, text: '测试成功' },
          ],
        } : conversation),
      };
    }
  }
}
