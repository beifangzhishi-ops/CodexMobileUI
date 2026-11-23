export const SIDEBAR_PULL_THRESHOLD = 72;

// Only a downward, predominantly vertical gesture starting at the top of the
// scrollable sidebar may refresh. This leaves normal scrolling and swipes alone.
export function sidebarPullDistance(startX: number, startY: number,
  x: number, y: number, scrollTop: number): number {
  const dy = y - startY;
  if (scrollTop > 0 || dy <= 0 || Math.abs(x - startX) > dy * 0.75) return 0;
  return Math.min(100, dy);
}
