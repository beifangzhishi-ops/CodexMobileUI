import type { ChatMessage } from '../core/protocol';
import type { Host } from '../core/host';
import type { CodexProject } from '../core/projectApi';

/** Presentation shapes. Conversation IDs, messages and project ownership originate on Codex. */
export type ChatConversation = {
  id: string;
  title: string;
  persisted: boolean;
  draft: string;
  messages: ChatMessage[];
  projectId: string | null;
  hostId: string | null;
  archived: boolean;
  updatedAt: number;
  pinned: boolean;
  running: boolean;
  unread: boolean;
};

export type ChatProject = CodexProject & {
  rules: string;
  pinned: boolean;
  updatedAt: number;
};

export type ChatHost = Host;

export const sortConversations = (items: readonly ChatConversation[]) =>
  [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);

export const sortProjects = (items: readonly ChatProject[]) =>
  [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
