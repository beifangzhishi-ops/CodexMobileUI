import { recordOf, type CodexThread } from '../core/protocol';
import { startLiveThread, type ThreadRpcClient } from '../core/threadApi';
import type { PendingSelectionRecord } from '../storage/database';

export function createPendingSelection(
  projectId: string | null, cwd: string | null,
): PendingSelectionRecord {
  const random = Array.from({ length: 3 }, () =>
    Math.floor(Math.random() * 0xffff_ffff).toString(16).padStart(8, '0')).join('');
  return { id: `${Date.now()}-${random}`, projectId, cwd };
}

export const pendingDraftKey = (selection: PendingSelectionRecord): string =>
  'pending:' + selection.id;

/** The only place where an unsent selection becomes a real Codex thread. */
export async function sendFirstTurn(
  client: ThreadRpcClient,
  selection: PendingSelectionRecord,
  text: string,
  onThreadCreated: (thread: CodexThread) => Promise<void>,
  onStartAttempt?: () => Promise<void> | void,
): Promise<CodexThread> {
  let cwd = selection.cwd;
  if (!cwd) {
    const response = recordOf(await client.request('workspace/prepare', { draftId: selection.id }));
    cwd = typeof response.cwd === 'string' ? response.cwd : null;
    if (!cwd || !(/^([A-Za-z]:[\\/]|\/)/.test(cwd))) {
      throw new Error('Gateway 没有确认无项目工作区路径');
    }
  }
  await onStartAttempt?.();
  const thread = await startLiveThread(client, cwd, selection.projectId);
  // Persist the new ID and draft before submitting the first turn. A failed
  // or timed-out turn/start must never lead to a second thread/start.
  await onThreadCreated(thread);
  await client.request('turn/start', {
    threadId: thread.id, input: [{ type: 'text', text }],
  });
  return thread;
}
