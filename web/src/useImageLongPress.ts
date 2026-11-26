import { useCallback, useEffect, useRef } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { gestureMoved } from './contextActions';

const LONG_PRESS_MS = 520;

export type MenuPoint = { x: number; y: number };

/**
 * Long-press handling for the already-open image viewer. A touch gesture is
 * cancelled by movement, pointer cancellation, a second touch, or unmount.
 */
export function useImageLongPress(active: boolean, onTrigger: (point: MenuPoint) => void) {
  const pointers = useRef(new Set<number>());
  const blockedUntilRelease = useRef(false);
  const pending = useRef<{
    pointerId: number;
    x: number;
    y: number;
    timer: number | null;
  } | null>(null);
  const triggerRef = useRef(onTrigger);
  triggerRef.current = onTrigger;

  const stopTimer = useCallback(() => {
    if (pending.current?.timer !== null && pending.current?.timer !== undefined) {
      window.clearTimeout(pending.current.timer);
    }
    pending.current = null;
  }, []);

  useEffect(() => {
    if (!active) {
      pointers.current.clear();
      blockedUntilRelease.current = false;
      stopTimer();
    }
    return stopTimer;
  }, [active, stopTimer]);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!active || event.pointerType !== 'touch') return;
    pointers.current.add(event.pointerId);
    if (pointers.current.size > 1) {
      blockedUntilRelease.current = true;
      stopTimer();
      return;
    }
    if (blockedUntilRelease.current || !(event.target instanceof Element) ||
        !event.target.closest('img')) return;
    const next = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: null as number | null,
    };
    next.timer = window.setTimeout(() => {
      if (!active || pending.current !== next || pointers.current.size !== 1 ||
          blockedUntilRelease.current) return;
      pending.current = null;
      triggerRef.current({ x: next.x, y: next.y });
    }, LONG_PRESS_MS);
    pending.current = next;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = pending.current;
    if (current?.pointerId === event.pointerId &&
        gestureMoved(current.x, current.y, event.clientX, event.clientY)) {
      stopTimer();
    }
  }

  function releasePointer(event: ReactPointerEvent<HTMLElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      blockedUntilRelease.current = false;
      stopTimer();
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    releasePointer(event);
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    releasePointer(event);
  }

  function onContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!active || !(event.target instanceof Element) || !event.target.closest('img')) return;
    event.preventDefault();
    event.stopPropagation();
    stopTimer();
    triggerRef.current({ x: event.clientX, y: event.clientY });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!active || !(event.key === 'ContextMenu' ||
        (event.shiftKey && event.key === 'F10'))) return;
    event.preventDefault();
    const image = event.currentTarget.querySelector('img');
    const bounds = image?.getBoundingClientRect();
    triggerRef.current({
      x: bounds ? bounds.left + Math.min(24, bounds.width / 2) : 16,
      y: bounds ? bounds.top + Math.min(24, bounds.height / 2) : 16,
    });
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu, onKeyDown };
}
