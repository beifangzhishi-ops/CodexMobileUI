import type { Message } from './types';

export function shouldReadSubAgentSnapshot(state: {
  online: boolean; visible: boolean; terminal: boolean; nativeActive: boolean; childRunning: boolean;
  hasSnapshot: boolean; terminalKey: string; completedTerminalKey: string | null;
}) {
  if (!state.online || !state.visible) return false;
  if (state.terminal) return state.completedTerminalKey !== state.terminalKey;
  return !state.hasSnapshot || state.nativeActive || state.childRunning;
}

/** Keep the verified full-history order and identifying text; compact reads only overlay state. */
export function mergeActivityHistory(history: Message[], activity: Message[]) {
  const merged = new Map(history.map((message) => [message.id, message]));
  for (const update of activity) {
    const old = merged.get(update.id);
    if (old) merged.set(update.id, { ...old,
      status: update.status ?? old.status,
      complete: update.complete ?? old.complete,
      failed: update.failed ?? old.failed,
    });
    else merged.set(update.id, update);
  }
  return [...merged.values()];
}
