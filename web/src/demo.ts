export type HostId = '6v' | 'noha';
export type HostFilter = HostId | 'all';
export type ConversationStatus = 'idle' | 'running' | 'unread';
export type Role = 'user' | 'assistant';

export type Message = {
  id: string;
  role: Role;
  content: string;
  activity?: { title: string; lines: string[] };
};

export type Conversation = {
  id: string;
  hostId: HostId;
  project: string | null;
  title: string;
  status: ConversationStatus;
  updatedAt: number;
  messages: Message[];
};

export const hosts: { id: HostId; displayName: string; description: string }[] = [
  { id: '6v', displayName: '6v', description: '开发电脑' },
  { id: 'noha', displayName: 'noha', description: '第二台电脑' },
];

export const projects: { id: string; name: string; hostId: HostId }[] = [
  { id: 'mobile', name: 'CodexMobileUI', hostId: '6v' },
  { id: 'website', name: '网页工作台', hostId: '6v' },
  { id: 'bridge', name: '共享服务', hostId: 'noha' },
];

// Purposefully fictional conversations: the prototype never reads local Codex data.
export function createDemoConversations(now = Date.now()): Conversation[] {
  return [
    {
      id: 'sample-gateway', hostId: '6v', project: 'mobile',
      title: '检查 Gateway 连接', status: 'unread', updatedAt: now - 1000 * 60 * 12,
      messages: [
        { id: 'sample-gateway-u', role: 'user', content: '检查一下 Gateway 的连接状态，顺便整理发现的问题。' },
        {
          id: 'sample-gateway-a', role: 'assistant',
          content: '这是用于展示排版的示例回复。实际连接后，这里将呈现来自对应电脑的真实执行结果。',
          activity: { title: '示例执行记录', lines: ['检查服务状态', '读取连接信息', '汇总检查结果'] },
        },
      ],
    },
    {
      id: 'sample-visual', hostId: '6v', project: 'website',
      title: '调整网页的侧边栏', status: 'idle', updatedAt: now - 1000 * 60 * 80,
      messages: [
        { id: 'sample-visual-u', role: 'user', content: '侧边栏缩窄一点，切换时要有推挤动画。' },
        { id: 'sample-visual-a', role: 'assistant', content: '这是一段演示内容，用来确认正文宽度、字距、消息间距和多行文字的阅读体验。' },
      ],
    },
    {
      id: 'sample-build', hostId: 'noha', project: 'bridge',
      title: '整理本地构建脚本', status: 'running', updatedAt: now - 1000 * 60 * 150,
      messages: [
        { id: 'sample-build-u', role: 'user', content: '看看构建脚本有哪些可以收敛的地方。' },
        { id: 'sample-build-a', role: 'assistant', content: '此处模拟 Codex 正在执行任务时的状态，连接真实服务器前不会执行任何命令。' },
      ],
    },
    {
      id: 'sample-design', hostId: '6v', project: null,
      title: '讨论多电脑工作台设计', status: 'idle', updatedAt: now - 1000 * 60 * 60 * 26,
      messages: [
        { id: 'sample-design-u', role: 'user', content: '做一个像 ChatGPT 的网页，用来控制多台电脑。' },
        { id: 'sample-design-a', role: 'assistant', content: '可以把每台电脑视作独立的执行端，在网页中统一查看会话。这里展示的是本地演示记录。' },
      ],
    },
    {
      id: 'sample-reconnect', hostId: 'noha', project: null,
      title: '研究断线后如何恢复会话', status: 'idle', updatedAt: now - 1000 * 60 * 60 * 50,
      messages: [
        { id: 'sample-reconnect-u', role: 'user', content: '切到另一台电脑时，不要影响正在进行的会话。' },
      ],
    },
  ];
}

export function getProjectName(id: string | null) {
  return projects.find((project) => project.id === id)?.name ?? null;
}

export function getDateGroup(timestamp: number, now: number) {
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (timestamp >= startOfToday) return '今天';
  if (timestamp >= startOfToday - 86400000) return '昨天';
  return '更早';
}
