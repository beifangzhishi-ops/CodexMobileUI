import type { HostId, Message } from './types';

/** Browser-only delivery state. Never insert this into native thread history. */
export type OptimisticSubmission = {
  id: string;
  hostId: HostId;
  key: string;
  originKey?: string;
  precedingMessageId?: string;
  text: string;
  submittedText: string;
  imageCount: number;
  fileCount?: number;
  expectedMatchCount: number;
  turnId?: string;
  steered?: boolean;
  status: 'sending' | 'accepted' | 'uncertain';
};

type NewSubmission = Pick<OptimisticSubmission,
  'id' | 'hostId' | 'key' | 'text' | 'submittedText' | 'imageCount' | 'fileCount'>;

function signature(text: string, imageCount: number, fileCount = 0) {
  return JSON.stringify([text, imageCount, fileCount]);
}

function canonicalSignature(message: Message) {
  return signature(message.content, message.images?.length ?? 0, message.files?.length ?? 0);
}

export function addOptimisticSubmission(
  previous: readonly OptimisticSubmission[], data: NewSubmission, canonical: readonly Message[],
): OptimisticSubmission[] {
  const target = signature(data.submittedText, data.imageCount, data.fileCount ?? 0);
  const canonicalCount = canonical.filter((message) =>
    message.role === 'user' && canonicalSignature(message) === target).length;
  const previousExpected = previous.filter((item) => item.key === data.key &&
    signature(item.submittedText, item.imageCount, item.fileCount ?? 0) === target)
    .reduce((max, item) => Math.max(max, item.expectedMatchCount), 0);
  return [...previous, { ...data, precedingMessageId: canonical.at(-1)?.id, expectedMatchCount: Math.max(canonicalCount, previousExpected) + 1,
    status: 'sending' as const }].slice(-60);
}

/** Render the local bubble only until its corresponding native user item appears. */
export function visibleOptimisticSubmissions(
  previous: readonly OptimisticSubmission[], key: string, canonical: readonly Message[],
): OptimisticSubmission[] {
  const counts = new Map<string, number>();
  for (const message of canonical) {
    if (message.role !== 'user') continue;
    const value = canonicalSignature(message);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return previous.filter((item) => {
    if (item.key !== key && item.originKey !== key) return false;
    // turn/steer shares the active turn ID with earlier user items. It must
    // match by occurrence count, not by that shared turn ID alone.
    if (item.turnId && !item.steered && canonical.some((message) =>
      message.role === 'user' && message.turnId === item.turnId)) return false;
    return (counts.get(signature(item.submittedText, item.imageCount, item.fileCount ?? 0)) ?? 0) <
      item.expectedMatchCount;
  });
}

/** Insert local bubbles without changing the order of the native timeline. */
export function positionOptimisticSubmissions(
  submissions: readonly OptimisticSubmission[], canonical: readonly Message[],
): Map<number, OptimisticSubmission[]> {
  const groups = new Map<number, OptimisticSubmission[]>();
  for (const item of submissions) {
    const turnStart = item.turnId && !item.steered
      ? canonical.findIndex((message) => message.turnId === item.turnId) : -1;
    const previous = item.precedingMessageId
      ? canonical.findIndex((message) => message.id === item.precedingMessageId) : -1;
    const index = turnStart >= 0 ? turnStart : previous >= 0 ? previous + 1
      : item.precedingMessageId ? canonical.length : 0;
    const group = groups.get(index) ?? [];
    group.push(item);
    groups.set(index, group);
  }
  return groups;
}

/** Only call after a successful native thread/read, not after a cached list refresh. */
export function reconcileOptimisticAfterRead(
  previous: readonly OptimisticSubmission[], key: string, canonical: readonly Message[],
): OptimisticSubmission[] {
  const visible = new Set(visibleOptimisticSubmissions(previous, key, canonical).map((item) => item.id));
  return previous.filter((item) => item.key !== key ||
    (item.status === 'sending' && visible.has(item.id)));
}
