import { useEffect, useRef, useState, useId } from 'react';
import { Check, ChevronDown, CircleX, RefreshCw } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown';
import type { HostId, Message } from './types';
import type { Snapshot } from './nativeProtocol';
import { mergeActivityHistory, reconcileSubAgentTurn, shouldReadSubAgentSnapshot } from './subAgentLifecycle';

type ReasoningPresentation = Pick<Message, 'content' | 'summaryParts' | 'reasoningText' | 'reasoningParts'>;

function displayParts(parts: string[] | undefined, joined: string | undefined): string[] {
  const nativeParts = (parts ?? []).filter((part) => part.trim());
  if (nativeParts.length) return nativeParts;
  return joined?.trim() ? [joined] : [];
}

function splitParagraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs: string[] = [];
  let current: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  const flush = () => {
    const paragraph = current.join('\n').trim();
    if (paragraph) paragraphs.push(paragraph);
    current = [];
  };
  for (const line of lines) {
    const fenceMarker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (closing?.[0] === fence.marker && closing.length >= fence.length) fence = null;
    } else if (fenceMarker) {
      fence = { marker: fenceMarker[0], length: fenceMarker.length };
    }
    if (!line.trim() && !fence) flush();
    else current.push(line);
  }
  flush();
  return paragraphs;
}

function comparisonKey(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  // Preserve significant whitespace around code while treating prose wraps and spacing as harmless.
  return normalized.includes('`') ? normalized.replace(/[ \t]+$/gm, '') : normalized.replace(/\s+/g, ' ');
}

/** Compare native display parts without rewriting their Markdown or other message data. */
export function visibleReasoningProcess(message: ReasoningPresentation): string {
  const summaryKeys = new Set<string>();
  for (const part of displayParts(message.summaryParts, message.content)) {
    summaryKeys.add(comparisonKey(part));
    for (const paragraph of splitParagraphs(part)) summaryKeys.add(comparisonKey(paragraph));
  }
  const seen = new Set<string>();
  const visibleParts: string[] = [];
  for (const part of displayParts(message.reasoningParts, message.reasoningText)) {
    if (summaryKeys.has(comparisonKey(part))) continue;
    const kept: string[] = [];
    for (const paragraph of splitParagraphs(part)) {
      const key = comparisonKey(paragraph);
      if (!key || summaryKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      kept.push(paragraph);
    }
    if (kept.length) visibleParts.push(kept.join('\n\n'));
  }
  return visibleParts.join('\n\n');
}

/** Public/native display text only. Keep manual expansion independent of stream updates. */
export function ReasoningActivity({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  const processId = useId();
  const processText = visibleReasoningProcess(message);
  return <div className="activity-card native-activity reasoning-activity">
    <div className="reasoning-heading">
      {message.complete ? <Check size={16}/> : <span className="activity-spinner"/>}
      <span>{message.content ? '思考摘要' : '思考过程'}</span>
    </div>
    {message.content && <div className="activity-native-body"><MessageMarkdown text={message.content}/></div>}
    {processText && <>
      <button type="button" className="reasoning-toggle" aria-controls={processId}
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <ChevronDown size={15} className={expanded ? 'expanded' : ''}/> {expanded ? '收起思考过程' : '展开思考过程'}
      </button>
      {expanded && <div id={processId} className="activity-native-body reasoning-process">
        <MessageMarkdown text={processText}/>
      </div>}
    </>}
  </div>;
}

export type SubAgentGroup = { childId: string; first: Message; latest: Message; records: Message[] };

/** Group separate native lifecycle items into one display row per child thread. */
export function groupSubAgentActivity(messages: readonly Message[]): SubAgentGroup[] {
  const groups = new Map<string, SubAgentGroup>();
  for (const message of messages) {
    if (message.activityType !== 'subAgentActivity' || !message.agentThreadId) continue;
    const existing = groups.get(message.agentThreadId);
    if (existing) { existing.latest = message; existing.records.push(message); }
    else groups.set(message.agentThreadId, { childId: message.agentThreadId,
      first: message, latest: message, records: [message] });
  }
  return [...groups.values()];
}

export function SubAgentActivityFeed({ hostId, parentId, group, online, readActivity, readHistory, onActivityChange }: {
  hostId: HostId; parentId: string; group: SubAgentGroup; online: boolean;
  readActivity: (hostId: HostId, parentId: string, childId: string) => Promise<Snapshot>;
  readHistory: (hostId: HostId, parentId: string, childId: string) => Promise<Snapshot>;
  onActivityChange?: (hostId: HostId, parentId: string, childId: string, signature: string | null) => void;
}) {
  const [activity, setActivity] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Snapshot | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [lastObservedAt, setLastObservedAt] = useState<number | null>(null);
  const [turnVerification, setTurnVerification] = useState<{ key: string; status: 'running' | 'terminal' | 'pending' | 'unknown'; terminalStatus?: string }>({ key: '', status: 'pending' });
  const [clock, setClock] = useState(() => Date.now());
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const wasOnline = useRef(online);
  const root = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const failureCount = useRef(0);
  const activityRef = useRef<Snapshot | null>(activity);
  activityRef.current = activity;
  const latestTurnId = useRef<string | null>(activity?.latestTurnId ?? null);
  const verificationRef = useRef<{ key: string; baselineTurnId: string | null; attempts: number; status: 'running' | 'terminal' | 'pending' | 'unknown'; terminalStatus?: string }>({
    key: '', baselineTurnId: null, attempts: 0, status: 'pending',
  });
  const finalReadKey = useRef<string | null>(null);
  const latestNativeStatus = group.latest.agentStatus ?? '';
  const lifecycleKey = `${group.latest.id}:${latestNativeStatus}`;
  const nativeTerminal = ['completed', 'failed', 'interrupted'].includes(latestNativeStatus);
  const nativeActive = ['started', 'interacted'].includes(latestNativeStatus);
  const currentVerification = turnVerification.key === lifecycleKey ? turnVerification : null;
  const childTerminal = Boolean(currentVerification?.status === 'terminal' || (!nativeActive && activity && !activity.running && ['completed', 'failed', 'interrupted'].includes(activity.terminalStatus ?? '')));

  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (online && !wasOnline.current) {
      failureCount.current = 0;
      const state = verificationRef.current;
      if (nativeActive && state.key === lifecycleKey && state.status === 'unknown') {
        verificationRef.current = { ...state, attempts: 0, status: 'pending' };
        setTurnVerification({ key: lifecycleKey, status: 'pending' });
      }
    }
    wasOnline.current = online;
  }, [online, nativeActive, lifecycleKey]);

  useEffect(() => {
    if (!online || !visible) return;
    if (nativeActive && verificationRef.current.key !== lifecycleKey) {
      const baselineTurnId = latestNativeStatus === 'interacted' ? latestTurnId.current : null;
      verificationRef.current = { key: lifecycleKey, baselineTurnId, attempts: 0, status: 'pending' };
      setTurnVerification({ key: lifecycleKey, status: 'pending' });
    }
    const verification = nativeActive && verificationRef.current.key === lifecycleKey ? verificationRef.current : null;
    const activeResolved = verification?.status === 'terminal' || verification?.status === 'unknown';
    const terminal = nativeTerminal || childTerminal;
    const terminalKey = nativeTerminal || nativeActive ? lifecycleKey :
      `snapshot:${group.childId}:${activityRef.current?.latestTurnId ?? activityRef.current?.terminalStatus ?? ''}`;
    if (!shouldReadSubAgentSnapshot({ online, visible, terminal, nativeActive,
      childRunning: activityRef.current?.running === true, hasSnapshot: activityRef.current !== null,
      activeResolved, terminalKey, completedTerminalKey: finalReadKey.current })) return;
    let current = true, timer = 0;
    const schedule = (delay: number) => { timer = window.setTimeout(load, delay); };
    const load = async () => {
      if (inFlight.current) { schedule(250); return; }
      inFlight.current = true;
      setBusy(true);
      try {
        const next = await readActivity(hostId, parentId, group.childId);
        if (!current) return;
        const signature = next.messages.map((m) => `${m.id}:${m.status}:${m.content}`).join('|') + ':' + next.terminalStatus;
        activityRef.current = next;
        latestTurnId.current = next.latestTurnId ?? latestTurnId.current;
        setActivity(next);
        setError(false);
        failureCount.current = 0;
        setLastObservedAt(Date.now());
        onActivityChange?.(hostId, parentId, group.childId, signature);
        const activeGeneration = nativeActive && verificationRef.current.key === lifecycleKey
          ? verificationRef.current : verification;
        const verdict = reconcileSubAgentTurn({
          nativeTerminalStatus: nativeTerminal ? latestNativeStatus : undefined,
          nativeActive, baselineTurnId: activeGeneration?.baselineTurnId ?? null,
          snapshotTurnId: next.latestTurnId ?? null, snapshotRunning: next.running,
          snapshotTerminalStatus: next.terminalStatus, attempts: activeGeneration?.attempts ?? 0,
        });
        if (nativeActive && activeGeneration) {
          verificationRef.current = { ...activeGeneration, status: verdict.status, attempts: verdict.attempts,
            terminalStatus: verdict.terminalStatus };
          setTurnVerification({ key: lifecycleKey, status: verdict.status, terminalStatus: verdict.terminalStatus });
        }
        const nextTerminal = verdict.status === 'terminal';
        if (terminal || nativeActive && nextTerminal) finalReadKey.current = terminalKey;
        else if (nextTerminal && !nativeActive) finalReadKey.current = `snapshot:${group.childId}:${next.latestTurnId ?? next.terminalStatus ?? ''}`;
        if (!terminal && !nativeTerminal && !activeResolved &&
            (nativeActive ? verdict.status === 'running' || verdict.status === 'pending'
              : verdict.status === 'running')) schedule(2500);
      } catch {
        if (!current) return;
        setError(true);
        failureCount.current++;
        const exhausted = failureCount.current >= 5;
        const activeGeneration = nativeActive && verificationRef.current.key === lifecycleKey
          ? verificationRef.current : verification;
        if (nativeActive && exhausted && activeGeneration) {
          verificationRef.current = { ...activeGeneration, status: 'unknown' };
          setTurnVerification({ key: lifecycleKey, status: 'unknown' });
        }
        if (failureCount.current <= 5 && !(nativeActive && exhausted))
          schedule(Math.min(12_000, 1000 * 2 ** (failureCount.current - 1)));
      } finally {
        inFlight.current = false;
        if (current) setBusy(false);
      }
    };
    void load();
    return () => { current = false; window.clearTimeout(timer); };
  }, [hostId, parentId, group.childId, lifecycleKey, latestNativeStatus, nativeTerminal, nativeActive, childTerminal, online, visible, readActivity, onActivityChange]);

  useEffect(() => () => onActivityChange?.(hostId, parentId, group.childId, null),
    [hostId, parentId, group.childId, onActivityChange]);

  async function openFullHistory() {
    if (historyBusy) return;
    setHistoryBusy(true); setError(false);
    try { setHistory(await readHistory(hostId, parentId, group.childId)); setShowHistory(true); }
    catch { setError(true); }
    finally { setHistoryBusy(false); }
  }

  const terminalStatus = nativeTerminal ? latestNativeStatus : currentVerification?.status === 'terminal'
    ? currentVerification.terminalStatus : !nativeActive ? activity?.terminalStatus : undefined;
  const running = online && !nativeTerminal && !error && (nativeActive
    ? currentVerification?.status === 'running' : activity?.running === true);
  useEffect(() => {
    if (!running || !online) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, online]);
  const lifecycle = terminalStatus === 'failed' ? '失败' : terminalStatus === 'interrupted' ? '已中断' :
    terminalStatus === 'completed' ? '已完成' : !online || error ? '同步待完成' : currentVerification?.status === 'unknown' ? '状态待确认' : running ? '运行中' :
      busy ? '同步中' : '状态待同步';
  const entries = activity?.messages ?? [];
  const displayEntries = showHistory && history ? mergeActivityHistory(history.messages, entries) : entries;
  const shown = !expanded ? displayEntries.slice(-1) : showHistory ? displayEntries : displayEntries.slice(-2);
  const name = group.latest.agentPath || activity?.threadName || '子 Agent';
  const metadata = [...new Set(group.records.map((record) => record.detail).filter(Boolean))].join(' · ');
  const age = !running || lastObservedAt == null ? '' : ` · 最近同步 ${Math.max(0, Math.floor((clock - lastObservedAt) / 1000))} 秒前`;

  return <section className="subagent-feed" ref={root} aria-label={`${name}活动`}>
    <button type="button" className="subagent-feed-toggle" aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}>
      {running ? <span className="activity-spinner"/> : ['failed', 'interrupted'].includes(terminalStatus ?? '')
        ? <CircleX size={15}/> : terminalStatus === 'completed' ? <Check size={15}/> : <RefreshCw size={14}/>}
      <strong>{name}</strong><span className={'subagent-lifecycle' + (terminalStatus === 'failed' ? ' is-failed' : '')}>{lifecycle}{age}</span>
      <ChevronDown size={15} className={expanded ? 'expanded' : ''}/>
    </button>
    {metadata && <div className="subagent-metadata">{metadata}</div>}
    {shown.length > 0 && <div className="subagent-history">
      {shown.map((entry) => <SubAgentEntry key={entry.id} entry={entry} full={showHistory}
        online={online && !error && !nativeTerminal && !childTerminal && currentVerification?.status !== 'unknown'}/>) }
    </div>}
    {expanded && <div className="subagent-feed-actions">
      {showHistory
        ? <><button type="button" className="subagent-read" disabled={historyBusy} onClick={() => void refreshFullHistory()}>
          {historyBusy ? <span className="activity-spinner"/> : <RefreshCw size={13}/>}刷新完整历史</button>
          <button type="button" className="subagent-read" onClick={() => setShowHistory(false)}>收起完整历史</button></>
        : <button type="button" className="subagent-read" disabled={historyBusy} onClick={() => void openFullHistory()}>
          {historyBusy ? <span className="activity-spinner"/> : <RefreshCw size={13}/>}展开完整活动历史</button>}
      {error && <span className="subagent-sync" role="status">连接恢复后重试同步</span>}
    </div>}
    {!shown.length && <p className="subagent-empty">{terminalStatus ? '暂无可用活动记录' : online ? '正在同步子 Agent 活动…' : '连接恢复后同步子 Agent 活动'}</p>}
  </section>;

  async function refreshFullHistory() {
    if (historyBusy) return;
    setHistoryBusy(true); setError(false);
    try { setHistory(await readHistory(hostId, parentId, group.childId)); }
    catch { setError(true); }
    finally { setHistoryBusy(false); }
  }
}

function SubAgentEntry({ entry, full, online }: { entry: Message; full: boolean; online: boolean }) {
  const failed = entry.failed || ['failed', 'error'].includes(entry.status ?? '');
  const active = entry.complete === false || ['inProgress', 'in_progress', 'running'].includes(entry.status ?? '');
  const heading = entry.kind ? entry.title || '活动' : entry.role === 'user' ? '用户' : '助手';
  return <div className={'subagent-entry' + (active ? online ? ' is-running' : ' is-stale' : failed ? ' is-failed' : ' is-complete')}>
    <span className="subagent-entry-icon">{active && online ? <span className="activity-spinner"/> :
      active ? <RefreshCw size={13}/> : failed ? <CircleX size={13}/> : <Check size={13}/>}</span>
    <div><strong>{heading}</strong>
      {entry.content && <p className={entry.kind === 'tool' ? 'subagent-tool-label' : undefined}>{entry.content}</p>}
      {full && entry.detail && <pre>{entry.detail}</pre>}
      {full && entry.kind === 'reasoning' && entry.reasoningText && <details><summary>展开思考文本</summary><pre>{entry.reasoningText}</pre></details>}
    </div>
  </div>;
}
