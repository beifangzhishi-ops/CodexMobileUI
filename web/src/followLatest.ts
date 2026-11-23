/** Distance between the visible viewport and the end of the message timeline. */
export function distanceFromLatest(scrollTop: number, viewportHeight: number, contentHeight: number): number {
  return Math.max(0, contentHeight - Math.max(0, scrollTop) - viewportHeight);
}

export const LATEST_THRESHOLD_PX = 60;

/**
 * Follow the stream while reading at the bottom. Scrolling upward explicitly
 * opts out; content growth by itself must never opt the reader out.
 */
export function nextFollowLatest(
  following: boolean, previousTop: number, currentTop: number, remaining: number,
): boolean {
  if (remaining <= LATEST_THRESHOLD_PX) return true;
  if (currentTop < previousTop - 1) return false;
  return following;
}
