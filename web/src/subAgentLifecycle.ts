import type { Message } from './types';

export type SubAgentGroup = { childId: string; first: Message; latest: Message; records: Message[] };

/** Keep one row anchored to the child's first lifecycle record in its latest parent turn. */
export function groupSubAgentActivity(messages: readonly Message[]): SubAgentGroup[] {
  const groups = new Map<string, SubAgentGroup>();
  for (const message of messages) {
    if (message.activityType !== 'subAgentActivity' || !message.agentThreadId) continue;
    const group = groups.get(message.agentThreadId);
    if (group) {
      if (group.latest.turnId !== message.turnId) group.first = message;
      group.latest = message;
      group.records.push(message);
    } else groups.set(message.agentThreadId, { childId: message.agentThreadId,
      first: message, latest: message, records: [message] });
  }
  return [...groups.values()];
}

export function shouldReadSubAgentSnapshot(state: {
  online: boolean; visible: boolean; terminal: boolean; nativeActive: boolean; childRunning: boolean;
  hasSnapshot: boolean; activeResolved: boolean; terminalKey: string; completedTerminalKey: string | null;
}) {
  if (!state.online || !state.visible) return false;
  if (state.terminal) return state.completedTerminalKey !== state.terminalKey;
  if (state.nativeActive && state.activeResolved) return false;
  return !state.hasSnapshot || state.nativeActive || state.childRunning;
}

const terminalTurnStatuses = new Set(['completed', 'failed', 'interrupted', 'cancelled']);
export type ChildTurnReconciliation = { status: 'running' | 'terminal' | 'pending' | 'unknown';
  terminalStatus?: string; attempts: number; turnId: string | null; observedRunningTurnId: string | null };

/** A parent interaction starts a new child generation; stale terminal snapshots cannot finish it. */
export function reconcileSubAgentTurn(state: {
  nativeTerminalStatus?: string; nativeActive: boolean; baselineTurnId: string | null;
  snapshotTurnId: string | null; snapshotRunning: boolean; snapshotTerminalStatus?: string;
  attempts: number; observedRunningTurnId?: string | null; maxAttempts?: number;
}): ChildTurnReconciliation {
  const turnId = state.snapshotTurnId;
  if (state.nativeTerminalStatus && terminalTurnStatuses.has(state.nativeTerminalStatus))
    return { status: 'terminal', terminalStatus: state.nativeTerminalStatus, attempts: state.attempts, turnId,
      observedRunningTurnId: state.observedRunningTurnId ?? null };
  const snapshotTerminal = Boolean(state.snapshotTerminalStatus && terminalTurnStatuses.has(state.snapshotTerminalStatus));
  if (!state.nativeActive) {
    if (state.snapshotRunning) return { status: 'running', attempts: 0, turnId, observedRunningTurnId: turnId };
    if (snapshotTerminal) return { status: 'terminal', terminalStatus: state.snapshotTerminalStatus, attempts: 0, turnId,
      observedRunningTurnId: state.observedRunningTurnId ?? null };
    return { status: 'pending', attempts: 0, turnId, observedRunningTurnId: state.observedRunningTurnId ?? null };
  }
  const sameOldTurn = Boolean(state.baselineTurnId && turnId === state.baselineTurnId);
  const observedRunningTurnId = state.observedRunningTurnId ?? null;
  if (sameOldTurn && !state.snapshotRunning) {
    if (snapshotTerminal && observedRunningTurnId === turnId)
      return { status: 'terminal', terminalStatus: state.snapshotTerminalStatus, attempts: 0, turnId, observedRunningTurnId };
    const attempts = state.attempts + 1;
    return { status: attempts >= (state.maxAttempts ?? 5) ? 'unknown' : 'pending', attempts, turnId, observedRunningTurnId };
  }
  if (state.snapshotRunning) return { status: 'running', attempts: 0, turnId,
    observedRunningTurnId: turnId };
  if (snapshotTerminal) return { status: 'terminal', terminalStatus: state.snapshotTerminalStatus, attempts: 0, turnId,
    observedRunningTurnId };
  const attempts = state.attempts + 1;
  return { status: attempts >= (state.maxAttempts ?? 5) ? 'unknown' : 'pending', attempts, turnId, observedRunningTurnId };
}

/** Keep the verified full-history order and identifying text; compact reads only overlay state. */
export function mergeActivityHistory(history: Message[], activity: Message[]) {
  const merged = new Map(history.map((message) => [message.id, message]));
  for (const update of activity) {
    const old = merged.get(update.id);
    if (old) {
      const oldTerminal = old.complete === true || old.failed === true ||
        ['completed', 'failed', 'interrupted', 'cancelled', 'error'].includes(old.status ?? '');
      merged.set(update.id, { ...old, ...(oldTerminal ? {} : {
        status: update.status ?? old.status,
        complete: update.complete ?? old.complete,
        failed: update.failed ?? old.failed,
      }) });
    }
    else merged.set(update.id, update);
  }
  return [...merged.values()];
}
