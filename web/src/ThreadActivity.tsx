import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleX, RefreshCw } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown';
import type { HostId, Message } from './types';
import type { Snapshot } from './nativeProtocol';

/** Public/native display text only. Keep manual expansion independent of stream updates. */
export function ReasoningActivity({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="activity-card native-activity reasoning-activity">
    <div className="reasoning-heading">
      {message.complete ? <Check size={16}/> : <span className="activity-spinner"/>}
      <span>{message.content ? '思考摘要' : '思考过程'}</span>
    </div>
    {message.content && <div className="activity-native-body"><MessageMarkdown text={message.content}/></div>}
    {message.reasoningText && <>
      <button type="button" className="reasoning-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <ChevronDown size={15} className={expanded ? 'expanded' : ''}/> {expanded ? '收起思考过程' : '展开思考过程'}
      </button>
      {expanded && <div className="activity-native-body reasoning-process"><MessageMarkdown text={message.reasoningText}/></div>}
    </>}
  </div>;
}

export function SubAgentDetails({ hostId, parentId, agentThreadId, agentName, parentRunning, syncPending, online = true, onStatus, read }: {
  hostId: HostId; parentId: string; agentThreadId: string;
  agentName?: string; parentRunning: boolean; syncPending?: boolean; online?: boolean;
  onStatus?: (hostId: HostId, parentId: string, agentThreadId: string, status: string | null) => void;
  read: (hostId: HostId, parentId: string, agentThreadId: string) => Promise<Snapshot>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<'recent' | 'all' | 'collapsed'>('recent');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const eventSignature = useRef('');
  useEffect(() => {
    let current = true, inFlight = false;
    if (!online) { setBusy(false); return () => { current = false; }; }
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await read(hostId, parentId, agentThreadId);
        if (!current) return;
        onStatus?.(hostId, parentId, agentThreadId, next.running ? 'running' : next.terminalStatus ?? null);
        const signature = next.messages.map((m) => m.id + ':' + m.content + ':' + m.status).join('|') + ':' + next.running;
        if (signature !== eventSignature.current) { eventSignature.current = signature; setLastEventAt(Date.now()); }
        setSnapshot(next);
        setError(false);
      } catch { if (current) setError(true); }
      finally { if (current) setBusy(false); inFlight = false; }
    };
    void load();
    const timer = window.setInterval(() => { if (parentRunning || snapshot?.running || error) void load(); }, 2500);
    return () => { current = false; window.clearInterval(timer); };
  }, [hostId, parentId, agentThreadId, parentRunning, read, snapshot?.running, error, online, onStatus]);
  useEffect(() => () => onStatus?.(hostId, parentId, agentThreadId, null), [hostId, parentId, agentThreadId, onStatus]);
  const entries = snapshot?.messages ?? [];
  const visible = mode === 'all' ? entries : entries.slice(mode === 'collapsed' ? -1 : -2);
  const lifecycle = snapshot?.running ? '运行中' : snapshot?.terminalStatus === 'failed' ? '失败' :
    snapshot?.terminalStatus === 'interrupted' ? '已中断' : snapshot?.terminalStatus === 'completed' ? '已完成' : '状态待同步';
  const age = lastEventAt == null ? '' : ` · 最近活动 ${Math.max(0, Math.floor((Date.now() - lastEventAt) / 1000))} 秒前`;
  return <div className="subagent-details">
    <div className="subagent-heading">
      {snapshot?.running ? <span className="activity-spinner"/> : ['failed', 'interrupted'].includes(snapshot?.terminalStatus ?? '')
        ? <CircleX size={14}/> : snapshot ? <Check size={14}/> : <RefreshCw size={14}/>}
      <strong>{agentName || snapshot?.threadName || '子 Agent'}</strong><span>{lifecycle}{age}</span>
      {(busy || error || syncPending) && <span className="subagent-sync">{error || syncPending ? '同步待完成' : '同步中'}</span>}
    </div>
    {entries.length > 0 && <>
      <div className="subagent-history">
        {visible.map((entry) => <div className="subagent-entry" key={entry.id}>
          <span className="subagent-entry-icon">{entry.complete === false ? <span className="activity-spinner"/> : <Check size={13}/>}</span>
          <div><strong>{entry.kind ? entry.title || '活动' : entry.role === 'user' ? '用户' : '助手'}</strong>
            {entry.content && <p>{entry.kind === 'tool' ? entry.title || entry.content : entry.content}</p>}
          </div>
        </div>)}
      </div>
      <button type="button" className="subagent-read" onClick={() => setMode(mode === 'all' ? 'collapsed' : mode === 'collapsed' ? 'recent' : 'all')}>
        <ChevronDown size={14} className={mode === 'all' ? 'expanded' : ''}/>
        {mode === 'all' ? '收起到最新活动' : mode === 'collapsed' ? '显示最近两项' : `查看全部活动 (${entries.length})`}
      </button>
    </>}
    {!entries.length && <p className="subagent-empty">{error || syncPending ? '连接恢复后同步子 Agent 活动' : '等待子 Agent 活动…'}</p>}
  </div>;
}
