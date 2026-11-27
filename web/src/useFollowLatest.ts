import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { distanceFromLatest, LATEST_THRESHOLD_PX, nextFollowLatest } from './followLatest';

/** The same scroll behavior is used by browser and Android WebView. */
export function useFollowLatest(
  threadKey: string | null,
  messages: unknown,
  localMessages: unknown,
  running: boolean,
  activityRevision = 0,
) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const lastTopRef = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const remaining = useCallback((node: HTMLDivElement) =>
    distanceFromLatest(node.scrollTop, node.clientHeight, node.scrollHeight), []);

  const updateJump = useCallback(() => {
    const node = scrollerRef.current;
    setShowJump(Boolean(node && !followingRef.current && remaining(node) > LATEST_THRESHOLD_PX));
  }, [remaining]);

  const snapToLatest = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    lastTopRef.current = node.scrollTop;
    setShowJump(false);
  }, []);

  const resumeToLatest = useCallback(() => {
    followingRef.current = true;
    snapToLatest();
  }, [snapToLatest]);

  const onScroll = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    followingRef.current = nextFollowLatest(
      followingRef.current, lastTopRef.current, node.scrollTop, remaining(node));
    lastTopRef.current = node.scrollTop;
    updateJump();
  }, [remaining, updateJump]);

  const jumpToLatest = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const gap = remaining(node);
    followingRef.current = true;
    setShowJump(false);
    // Avoid a many-second animation through a very long conversation.
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const behavior: ScrollBehavior = reduceMotion || gap > node.clientHeight * 2 ? 'instant' : 'smooth';
    node.scrollTo({ top: node.scrollHeight, behavior });
    if (behavior === 'instant') lastTopRef.current = node.scrollTop;
  }, [remaining]);

  // Each thread starts at its newest message, independently of the previous one.
  useLayoutEffect(() => {
    followingRef.current = true;
    lastTopRef.current = 0;
    setShowJump(false);
    if (threadKey) snapToLatest();
  }, [threadKey, snapToLatest]);

  // Streamed text and optimistic messages can grow without adding a new DOM node.
  useLayoutEffect(() => {
    if (!threadKey) return;
    if (followingRef.current) snapToLatest();
    else updateJump();
  }, [threadKey, messages, localMessages, running, activityRevision, snapToLatest, updateJump]);

  // Also follow late image/Markdown layout changes and viewport/keyboard resizing.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!threadKey || !scroller || !content) return;
    const handleResize = () => {
      if (followingRef.current) snapToLatest();
      else updateJump();
    };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(handleResize);
      observer.observe(scroller);
      observer.observe(content);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [threadKey, snapToLatest, updateJump]);

  return { scrollerRef, contentRef, showJump, onScroll, jumpToLatest, resumeToLatest };
}
