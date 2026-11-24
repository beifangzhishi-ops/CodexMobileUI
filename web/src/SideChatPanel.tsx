import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Plus, RefreshCw, Square, X } from 'lucide-react';
import type { Conversation } from './types';
import type { useLiveCodex } from './useLiveCodex';
import type { PathHosts } from './pathHosts';
import { MessageMarkdown } from './MessageMarkdown';
import { ReasoningActivity, SubAgentDetails } from './ThreadActivity';

type Props = {
  source: Conversation;
  live: ReturnType<typeof useLiveCodex>;
  pathHosts: PathHosts;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string, expected?: string) => void;
  onClose: () => void;
  initialSelection?: string;
};
export function SideChatPanel({ source, live, pathHosts, drafts, setDraft, onClose, initialSelection }: Props) {
  const [selected, setSelected] = useState<string | null | undefined>(initialSelection ? null : undefined);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const [needsCheck, setNeedsCheck] = useState(false);
  const busy = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const hostId = source.hostId, sourceId = source.id;
  const online = live.status[hostId] === 'online';
  const sides = live.conversations.filter((c) => c.hostId === hostId && c.attachedToThreadId === sourceId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const side = sides.find((c) => c.id === selected);
  const keyFor = (id: string | null | undefined) => hostId + ':' + sourceId + ':' + (id ?? 'new');
  const draftKey = keyFor(selected), draft = drafts[draftKey] ?? '';
  // The native attached-thread read contains its own turns only; inherited
  // context is server-owned and must not be duplicated or heuristically hidden.
  const messages = side?.messages ?? [];
  const { listSideChats, loadSideChat } = live;

  useEffect(() => {
    if (!online) { setLoading(false); return; }
    let current = true;
    setLoading(true); setError('');
    void listSideChats(hostId, sourceId).then((rows) => {
      if (!current) return;
      setSelected((old) => old === undefined ? rows[0]?.id ?? null : old);
    }).catch(() => { if (current) setError('旁路对话列表暂不可用，请刷新。'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [hostId, sourceId, online, listSideChats]);
  useEffect(() => {
    if (!online || !selected) return;
    let current = true;
    void loadSideChat(hostId, selected).catch(() => {
      if (current) setError('旁路对话读取失败，请刷新。');
    });
    return () => { current = false; };
  }, [hostId, online, selected, loadSideChat]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [selected, messages.length, messages.at(-1)?.content]);
  useEffect(() => {
    if (initialSelection) input.current?.focus();
  }, [initialSelection]);

  async function refresh() {
    if (busy.current || !online) return;
    setLoading(true); setError('');
    try {
      const rows = await listSideChats(hostId, sourceId);
      if (selected) await loadSideChat(hostId, selected);
      else if (needsCheck && rows.length) setSelected(rows[0].id);
      setNeedsCheck(false);
    } catch { setError('刷新失败，请检查服务器连接。'); }
    finally { setLoading(false); }
  }
  async function send() {
    if (busy.current || !online || side?.running || needsCheck || loading || !draft.trim()) return;
    busy.current = true; setSending(true); setError('');
    let id = selected;
    const value = draft.trim();
    try {
      if (!id) {
        id = await live.createSideChat(hostId, sourceId);
        setSelected(id);
        setDraft(keyFor(id), draft);
        setDraft(draftKey, '', draft);
      }
      await live.send(hostId, id, source.project, value, { pathHosts });
      setDraft(keyFor(id), '', draft);
    } catch (e) {
      const ambiguous = /UNCONFIRMED|TIMEOUT|DISCONNECTED/i.test(String(e));
      if (ambiguous) setNeedsCheck(true);
      setError(ambiguous ? '操作未确认，请刷新记录后决定是否重试。' : '旁路对话操作失败，草稿已保留。');
    } finally { busy.current = false; setSending(false); }
  }
  async function stop() {
    if (busy.current || !selected || !side?.activeTurnId) return;
    busy.current = true; setStopping(true);
    try { await live.interrupt(hostId, selected); }
    catch { setError('停止未确认，请刷新记录。'); }
    finally { busy.current = false; setStopping(false); }
  }
  return <aside className="side-chat-panel" aria-label="旁路对话">
    <header className="side-chat-header">
      <strong>旁路对话</strong>
      <button type="button" title="刷新旁路对话" aria-label="刷新旁路对话" disabled={!online || loading || sending}
        onClick={() => void refresh()}><RefreshCw size={17}/></button>
      <button type="button" title="关闭旁路对话" aria-label="关闭旁路对话" onClick={onClose}><X size={19}/></button>
    </header>
    <div className="side-chat-parent">{source.title} · {source.running ? '主任务运行中' : '主对话空闲'}</div>
    <div className="side-chat-tabs" role="tablist" aria-label="旁路对话列表">
      {sides.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={selected === item.id}
        disabled={sending} title={item.title} onClick={() => { setSelected(item.id); setError(''); }}>
        {item.running && <span className="activity-spinner"/>}{item.title === '新对话' ? '旁路 ' + (index + 1) : item.title}
      </button>)}
      <button type="button" title="新建旁路对话" aria-label="新建旁路对话" disabled={sending}
        onClick={() => { setSelected(null); setError(''); input.current?.focus(); }}><Plus size={17}/></button>
    </div>
    <div className="side-chat-messages" ref={scroll}>
      {loading && <p className="side-status">正在读取旁路对话…</p>}
      {!online && <p className="side-status">服务器未连接</p>}
      {!loading && !messages.length && <p className="side-chat-empty">围绕当前对话单独提问，不打断主任务。</p>}
      {messages.map((message) => <article key={message.id} className={'side-message side-' + message.role}>
        {message.kind === 'reasoning' ? <ReasoningActivity message={message}/> :
          message.kind ? <details className="activity-card native-activity">
            <summary>{message.title || '活动'}<ChevronDown size={15}/></summary>
            <div className="activity-native-body">
              {message.content && <MessageMarkdown text={message.content}/>}
              {message.detail && <pre>{message.detail}</pre>}
              {message.agentThreadId && side && <SubAgentDetails hostId={hostId} parentId={side.id}
                agentThreadId={message.agentThreadId} read={live.readSubAgent}/>}
            </div>
          </details> : message.role === 'user' ? <div className="user-bubble">{message.content}</div> :
            <MessageMarkdown text={message.content} hostId={hostId} threadId={side?.id}
              itemId={message.id.slice(message.id.indexOf(':') + 1)} imageReady={message.complete !== false}/>}
      </article>)}
      {side?.running && <p className="side-status"><span className="activity-spinner"/>旁路任务运行中</p>}
    </div>
    {error && <div className="side-chat-error" role="status">{error}</div>}
    <div className="side-chat-composer">
      {side?.model && <span className="side-status">{side.model}{side.reasoningEffort ? ' · ' + side.reasoningEffort : ''}</span>}
      <textarea ref={input} value={draft} maxLength={12000} placeholder="在旁路对话中提问"
        onChange={(e) => setDraft(draftKey, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing &&
          window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); void send(); } }}/>
      <div className="side-chat-actions">
        <button type="button" className={'send-button' + (side?.running ? ' stop-mode' : '')}
          title={side?.running ? '停止旁路任务' : '发送旁路消息'} aria-label={side?.running ? '停止旁路任务' : '发送旁路消息'}
          disabled={!online || sending || stopping || (side?.running ? !side.activeTurnId : loading || needsCheck || !draft.trim())}
          onClick={() => side?.running ? void stop() : void send()}>
          {sending || stopping ? <span className="activity-spinner"/> : side?.running ? <Square size={15} fill="currentColor"/> : <ArrowUp size={20}/>}
        </button>
      </div>
    </div>
  </aside>;
}
