import type { Message } from './types';

export type CompactionPhase = 'starting' | 'working' | 'completed' | 'failed' | 'unknown' | 'unconfirmed';
export type CompactionJob = { phase: CompactionPhase; baseline: Set<string>; turnId?: string; timer?: number; dispatched?: boolean };
export const compactionBusy = (phase?: CompactionPhase) => phase === 'starting' || phase === 'working' || phase === 'unknown';
export function compactionOutcome(job: CompactionJob, messages: readonly Message[]): CompactionPhase | undefined {
  const item = messages.find((m) => m.activityType === 'contextCompaction' && !job.baseline.has(m.id) &&
    (!job.turnId || job.turnId === m.turnId));
  if (!item) return undefined;
  if (item.turnStatus === 'completed' && item.complete) return 'completed';
  if (['failed', 'interrupted'].includes(item.turnStatus ?? '')) return 'failed';
  return 'working';
}
