import React, { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReasoningActivity, SubAgentActivityFeed, groupSubAgentActivity } from '../../src/ThreadActivity';
import type { Message } from '../../src/types';
import type { NativeNotice, Snapshot } from '../../src/nativeProtocol';
import '../../src/desktop.css';

const parentId = 'parent-thread-fixture';
const childId = 'child-thread-fixture';
const activityRecord = (id: string, turnId: string, agentStatus: string): Message => ({
  id, role: 'assistant', kind: 'subAgentActivity', activityType: 'subAgentActivity',
  content: agentStatus === 'interacted' ? '子 Agent 收到新的父会话工作' : '子 Agent 已启动',
  agentThreadId: childId, agentPath: 'fixture/researcher', agentStatus, turnId, complete: true,
});
const tool = (id: string, content: string, status: string): Message => ({
  id, role: 'assistant', kind: 'tool', title: '执行工具', content, status,
  complete: status === 'completed',
});
let snapshots: Snapshot[] = [];
let lastSnapshot: Snapshot = {
  activeTurnId: 'child-turn-1', runningSinceMs: null, threadName: 'fixture/researcher', messages: [
    tool('child-tool-1', '检查项目结构', 'completed'),
    tool('child-tool-2', '读取最新文件', 'inProgress'),
  ], latestTurnId: 'child-turn-1', running: true,
};
let activityReads: Array<{ hostId: string; parentId: string; childId: string }> = [];
const listeners = new Set<(notice: NativeNotice) => void>();
const subscribe = (_host: string, _child: string, listener: (notice: NativeNotice) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
let sequence = 0;
let collapseCount = 0;
const onCollapse = () => { collapseCount++; };
function emitActivity(count = 1) {
  for (let i = 0; i < count; i++) {
    const n = ++sequence;
    for (const listener of listeners) listener({ method: 'item/completed', params: {
      turnId: lastSnapshot.latestTurnId, item: { id: `live-${n}`, type: 'commandExecution',
        command: `live activity ${n} ` + 'detail '.repeat(20), status: 'completed' },
    } });
  }
}
const readActivity = async (hostId: '6v' | 'noha', parent: string, child: string) => {
  activityReads.push({ hostId, parentId: parent, childId: child });
  if (snapshots.length) lastSnapshot = snapshots.shift()!;
  return lastSnapshot;
};
const readHistory = async (_hostId: '6v' | 'noha', _parent: string, _child: string) => ({
  ...lastSnapshot, messages: [tool('child-tool-1', '检查项目结构', 'completed'),
    tool('child-tool-2', '读取最新文件', 'completed'),
    { id: 'child-answer', role: 'assistant', content: '子会话完整答复。', complete: true } as Message],
});

function App() {
  const [parentTurnId, setParentTurnId] = useState('parent-turn-1');
  const [parentMessages, setParentMessages] = useState<Message[]>([activityRecord('activity-start', 'parent-turn-1', 'started')]);
  const groups = groupSubAgentActivity(parentMessages);
  const group = groups[0];
  const currentTurnRecords = parentMessages.filter((message) => message.turnId === parentTurnId);
  const stableReadActivity = useCallback(readActivity, []);
  const stableReadHistory = useCallback(readHistory, []);
  function newInteraction() {
    snapshots = [
      { ...lastSnapshot, latestTurnId: 'child-turn-1', running: false, terminalStatus: 'completed' },
      { activeTurnId: 'child-turn-2', runningSinceMs: Date.now(), threadName: 'fixture/researcher', messages: [
        tool('child-tool-3', '响应父会话的新工作', 'inProgress'),
      ], latestTurnId: 'child-turn-2', running: true },
    ];
    setParentTurnId('parent-turn-2');
    setParentMessages((current) => [...current, activityRecord('activity-interacted', 'parent-turn-2', 'interacted')]);
  }
  function completeChild() {
    snapshots = [{
      activeTurnId: null, runningSinceMs: null, threadName: 'fixture/researcher', messages: [
        tool('child-tool-3', '响应父会话的新工作', 'completed'),
        { id: 'child-answer', role: 'assistant', content: '子会话完成答复。', complete: true } as Message,
      ], latestTurnId: 'child-turn-2', running: false, terminalStatus: 'completed',
    }];
    setParentTurnId('parent-turn-2');
    setParentMessages((current) => [...current, activityRecord('activity-completed', 'parent-turn-2', 'completed')]);
  }
  Object.assign(window, { fixture: { newInteraction, completeChild, emitActivity,
    get collapseCount() { return collapseCount; }, get activityReads() { return activityReads; } } });
  return <main className="fixture-shell">
    <nav className="fixture-controls">
      <button id="new-interaction" onClick={newInteraction}>父会话新一轮交互</button>
      <button id="complete-child" onClick={completeChild}>结束子 Agent</button>
    </nav>
    <div className="side-chat-panel" data-testid="side-chat-panel">
      <h1>旁路对话 · fixture/researcher</h1>
      <section className="parent-turn" data-testid="parent-turn" data-parent-turn={parentTurnId}>
        <p className="parent-message">父会话当前回合 {parentTurnId}</p>
        {currentTurnRecords.map((message) => {
          const anchoredGroup = groups.find((candidate) => candidate.first.id === message.id);
          return anchoredGroup && <article key={anchoredGroup.childId} className="side-message side-assistant side-subagent-activity"
            data-subagent-anchor={message.id}>
            <SubAgentActivityFeed hostId="6v" parentId={parentId} group={anchoredGroup} online
              readActivity={stableReadActivity} readHistory={stableReadHistory} subscribeNotices={subscribe} onCollapse={onCollapse}/>
          </article>;
        })}
      </section>
      <ReasoningActivity message={{ id: 'reasoning-fixture', role: 'assistant', kind: 'reasoning',
        content: '思考摘要保留', reasoningText: '未在摘要中重写的思考过程。', complete: true }}/>
      <div className="assistant-completion" data-testid="assistant-completion">父会话已完成回复，活动刷新后仍保留。</div>
    </div>
  </main>;
}

const style = document.createElement('style');
style.textContent = `
  html, body, #root { margin: 0; min-height: 100%; background: #111; color: #eee; font: 14px system-ui, sans-serif; }
  .fixture-shell { padding: 16px; width: min(100%, 900px); margin: 0 auto; }
  .fixture-controls { display: flex; gap: 8px; padding-bottom: 12px; }
  .fixture-controls button { padding: 8px 12px; color: #eee; background: #303030; border: 1px solid #555; border-radius: 6px; }
  .side-chat-panel { width: 100%; min-width: 0; padding: 12px; background: #1a1a1a; border: 1px solid #333; border-radius: 10px; }
  .side-chat-panel h1 { font-size: 16px; }
  .parent-turn { border-left: 2px solid #64748b; padding-left: 10px; min-width: 0; }
  .parent-message { color: #aaa; }
  .assistant-completion { padding: 8px 0; }
`;
document.head.append(style);
createRoot(document.getElementById('root')!).render(<App/>);
