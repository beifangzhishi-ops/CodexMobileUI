export const PROJECT_THREAD_PREVIEW_LIMIT = 5;

export function visibleProjectThreads<T>(threads: readonly T[], showAll: boolean): readonly T[] {
  return showAll ? threads : threads.slice(0, PROJECT_THREAD_PREVIEW_LIMIT);
}
