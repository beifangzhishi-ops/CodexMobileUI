export type HostId = string;
export type Host = { id: HostId; displayName: string };
export const validHostId = (id: unknown): id is HostId =>
  typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(id) && !['all', 'constructor', 'prototype'].includes(id);
export type HostFilter = HostId | 'all';
export type ConversationStatus = 'idle' | 'running' | 'unread';
export type Role = 'user' | 'assistant';

export type Message = {
  id: string;
  role: Role;
  content: string;
  turnId?: string;
  turnStatus?: string;
  timestampMs?: number;
  ordinal?: number;
  complete?: boolean;
  kind?: 'reasoning' | 'tool' | 'plan' | 'turnError';
  activityType?: string;
  pluginId?: string;
  appId?: string;
  toolServer?: string;
  toolName?: string;
  title?: string;
  detail?: string;
  status?: string;
  failed?: boolean;
  summaryParts?: string[];
  reasoningParts?: string[];
  reasoningText?: string;
  agentThreadId?: string;
  agentPath?: string;
  agentStatus?: string;
  /** Image references are matched to native user item IDs, never host paths. */
  images?: { itemId: string; imageIndex: number }[];
  /** Host-managed documents are identified through the native user item, not a browser path. */
  files?: { itemId: string; fileIndex: number; name: string; path: string }[];
  activity?: { title: string; lines: string[] };
};

export type Conversation = {
  id: string;
  hostId: HostId;
  project: string | null;
  /** Native thread working directory, when provided by thread/list. */
  cwd?: string | null;
  title: string;
  /** Native thread settings, not a host-wide dropdown preference. */
  model?: string | null;
  reasoningEffort?: string | null;
  status: ConversationStatus;
  archived?: boolean;
  updatedAt: number;
  running?: boolean;
  activeTurnId?: string | null;
  runningSinceMs?: number | null;
  syncPending?: boolean;
  localCreated?: boolean;
  /** A durable Side Chat, excluded from the ordinary navigation list. */
  attachedToThreadId?: string;
  messages: Message[];
};
