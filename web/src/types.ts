export type HostId = '6v' | 'noha';
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
  kind?: 'reasoning' | 'tool' | 'plan';
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
  status: ConversationStatus;
  archived?: boolean;
  updatedAt: number;
  running?: boolean;
  activeTurnId?: string | null;
  runningSinceMs?: number | null;
  syncPending?: boolean;
  localCreated?: boolean;
  messages: Message[];
};

// Host registration is fixed here; project and thread data always comes from Codex.
export const hosts: { id: HostId; displayName: string }[] = [
  { id: '6v', displayName: '6v' },
  { id: 'noha', displayName: 'noha' },
];
