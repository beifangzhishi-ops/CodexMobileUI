import type { Message } from './types';

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
  terminalStatus?: string; attempts: number; turnId: string | null };

/** A parent interaction starts a new child generation; stale terminal snapshots cannot finish it. */
export function reconcileSubAgentTurn(state: {
  nativeTerminalStatus?: string; nativeActive: boolean; baselineTurnId: string | null;
  snapshotTurnId: string | null; snapshotRunning: boolean; snapshotTerminalStatus?: string;
  attempts: number; maxAttempts?: number;
}): ChildTurnReconciliation {
  const turnId = state.snapshotTurnId;
  if (state.nativeTerminalStatus && terminalTurnStatuses.has(state.nativeTerminalStatus))
    return { status: 'terminal', terminalStatus: state.nativeTerminalStatus, attempts: state.attempts, turnId };
  const snapshotTerminal = Boolean(state.snapshotTerminalStatus && terminalTurnStatuses.has(state.snapshotTerminalStatus));
  if (!state.nativeActive) {
    if (state.snapshotRunning) return { status: 'running', attempts: 0, turnId };
    if (snapshotTerminal) return { status: 'terminal', terminalStatus: state.snapshotTerminalStatus, attempts: 0, turnId };
    return { status: 'pending', attempts: 0, turnId };
  }
  const sameOldTurn = Boolean(state.baselineTurnId && turnId === state.baselineTurnId);
  if (sameOldTurn && !state.snapshotRunning) {
    const attempts = state.attempts + 1;
    return { status: attempts >= (state.maxAttempts ?? 5) ? 'unknown' : 'pending', attempts, turnId };
  }
  if (state.snapshotRunning) return { status: 'running', attempts: 0, turnId };
  if (snapshotTerminal) return { status: 'terminal', terminalStatus: state.snapshotTerminalStatus, attempts: 0, turnId };
  const attempts = state.attempts + 1;
  return { status: attempts >= (state.maxAttempts ?? 5) ? 'unknown' : 'pending', attempts, turnId };
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
