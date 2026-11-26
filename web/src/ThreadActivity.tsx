import { useId, useState } from 'react';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown';
import type { HostId, Message } from './types';
import type { Snapshot } from './nativeProtocol';

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

export function SubAgentDetails({ hostId, parentId, agentThreadId, read }: {
  hostId: HostId; parentId: string; agentThreadId: string;
  read: (hostId: HostId, parentId: string, agentThreadId: string) => Promise<Snapshot>;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function load() {
    if (busy) return;
    setBusy(true); setError(false);
    try { setSnapshot(await read(hostId, parentId, agentThreadId)); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  return <div className="subagent-details">
    <button type="button" className="subagent-read" disabled={busy} onClick={() => void load()}>
      {busy ? <span className="activity-spinner"/> : <RefreshCw size={14}/>}
      {snapshot ? '刷新子 Agent 对话' : '查看子 Agent 对话'}
    </button>
    {error && <p>子 Agent 对话暂不可读取。</p>}
    {snapshot && <div className="subagent-history">
      {snapshot.running && <span className="side-status">运行中</span>}
      {!snapshot.messages.length && <p>服务器暂未返回可展示的消息。</p>}
      {snapshot.messages.map((entry) => <div className="subagent-entry" key={entry.id}>
        {entry.kind === 'reasoning' ? <ReasoningActivity message={entry}/> : <>
          <strong>{entry.kind ? entry.title || '活动' : entry.role === 'user' ? '输入' : '助手'}</strong>
          {entry.content && <MessageMarkdown text={entry.content}/>}
          {entry.detail && <pre>{entry.detail}</pre>}
        </>}
      </div>)}
    </div>}
  </div>;
}
