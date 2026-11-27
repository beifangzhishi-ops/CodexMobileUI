export const PROJECT_THREAD_PREVIEW_LIMIT = 5;
export const PROJECT_THREAD_PAGE_SIZE = 10;

export function visibleProjectThreads<T>(threads: readonly T[], limit = PROJECT_THREAD_PREVIEW_LIMIT): readonly T[] {
  return threads.slice(0, Math.max(0, limit));
}

export function nextProjectThreadLimit(current: number, total: number): number {
  return Math.min(total, current + PROJECT_THREAD_PAGE_SIZE);
}

export function clearProjectThreadLimit(limits: Readonly<Record<string, number>>, key: string): Record<string, number> {
  if (!(key in limits)) return limits as Record<string, number>;
  const next = { ...limits };
  delete next[key];
  return next;
}
