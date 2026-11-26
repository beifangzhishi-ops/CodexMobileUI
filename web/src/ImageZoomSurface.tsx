import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import './imageZoom.css';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const MOVE_THRESHOLD = 3;
const SCALE_EPSILON = 0.001;

type Point = {
  x: number;
  y: number;
};

type ImageTransform = {
  scale: number;
  x: number;
  y: number;
};

type ImageGeometry = {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type SingleGesture = {
  kind: 'single';
  pointerId: number;
  start: Point;
  startTransform: ImageTransform;
  moved: boolean;
};

type PinchGesture = {
  kind: 'pinch';
  pointerIds: [number, number];
  startDistance: number;
  startScale: number;
  contentAnchor: Point;
  geometry: ImageGeometry;
};

type Gesture = SingleGesture | PinchGesture;

const INITIAL_TRANSFORM: ImageTransform = { scale: MIN_SCALE, x: 0, y: 0 };

function midpoint(first: Point, second: Point): Point {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function geometryFor(image: HTMLImageElement, transform: ImageTransform): ImageGeometry | null {
  const rect = image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const width = rect.width / transform.scale;
  const height = rect.height / transform.scale;
  return {
    width,
    height,
    centerX: rect.left + rect.width / 2 - transform.x,
    centerY: rect.top + rect.height / 2 - transform.y,
  };
}

function clampTransform(
  image: HTMLImageElement, geometry: ImageGeometry, next: ImageTransform,
): ImageTransform {
  if (next.scale <= MIN_SCALE + SCALE_EPSILON) {
    return INITIAL_TRANSFORM;
  }
  const viewport = image.parentElement?.getBoundingClientRect();
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return next;
  const visualHalfWidth = geometry.width * next.scale / 2;
  const visualHalfHeight = geometry.height * next.scale / 2;
  const leftLimit = viewport.left - (geometry.centerX - visualHalfWidth);
  const rightLimit = viewport.right - (geometry.centerX + visualHalfWidth);
  const topLimit = viewport.top - (geometry.centerY - visualHalfHeight);
  const bottomLimit = viewport.bottom - (geometry.centerY + visualHalfHeight);
  return {
    scale: next.scale,
    x: clamp(next.x, Math.min(leftLimit, rightLimit), Math.max(leftLimit, rightLimit)),
    y: clamp(next.y, Math.min(topLimit, bottomLimit), Math.max(topLimit, bottomLimit)),
  };
}

export function ImageZoomSurface({
  src, alt, className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const transformRef = useRef<ImageTransform>(INITIAL_TRANSFORM);
  const [transform, setTransform] = useState<ImageTransform>(INITIAL_TRANSFORM);

  const applyTransform = (next: ImageTransform) => {
    transformRef.current = next;
    setTransform(next);
  };

  const beginSingle = (pointerId: number, point: Point) => {
    gesture.current = {
      kind: 'single',
      pointerId,
      start: point,
      startTransform: transformRef.current,
      moved: false,
    };
  };

  const beginPinch = (firstId: number, secondId: number) => {
    const image = imageRef.current;
    const first = pointers.current.get(firstId);
    const second = pointers.current.get(secondId);
    if (!image || !first || !second) return;
    const current = transformRef.current;
    const geometry = geometryFor(image, current);
    const startDistance = distance(first, second);
    if (!geometry || startDistance <= 0) return;
    const startMidpoint = midpoint(first, second);
    gesture.current = {
      kind: 'pinch',
      pointerIds: [firstId, secondId],
      startDistance,
      startScale: current.scale,
      contentAnchor: {
        x: (startMidpoint.x - geometry.centerX - current.x) / current.scale,
        y: (startMidpoint.y - geometry.centerY - current.y) / current.scale,
      },
      geometry,
    };
  };

  const beginPinchFromPointers = () => {
    const ids = [...pointers.current.keys()];
    if (ids.length >= 2) beginPinch(ids[0], ids[1]);
  };

  useLayoutEffect(() => {
    pointers.current.clear();
    gesture.current = null;
    transformRef.current = INITIAL_TRANSFORM;
    setTransform(INITIAL_TRANSFORM);
  }, [src]);

  useEffect(() => () => {
    pointers.current.clear();
    gesture.current = null;
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLImageElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; movement still works without it.
    }
    if (pointers.current.size === 1) {
      beginSingle(event.pointerId, { x: event.clientX, y: event.clientY });
      return;
    }
    beginPinchFromPointers();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLImageElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);
    const active = gesture.current;
    if (!active) return;

    if (active.kind === 'single' && active.pointerId === event.pointerId) {
      const deltaX = point.x - active.start.x;
      const deltaY = point.y - active.start.y;
      if (!active.moved && Math.hypot(deltaX, deltaY) < MOVE_THRESHOLD) return;
      if (active.startTransform.scale <= MIN_SCALE + SCALE_EPSILON) return;
      active.moved = true;
      event.preventDefault();
      const image = imageRef.current;
      const geometry = image ? geometryFor(image, active.startTransform) : null;
      if (!image || !geometry) return;
      applyTransform(clampTransform(image, geometry, {
        scale: active.startTransform.scale,
        x: active.startTransform.x + deltaX,
        y: active.startTransform.y + deltaY,
      }));
      return;
    }

    if (active.kind !== 'pinch') return;
    const first = pointers.current.get(active.pointerIds[0]);
    const second = pointers.current.get(active.pointerIds[1]);
    if (!first || !second) {
      beginPinchFromPointers();
      return;
    }
    event.preventDefault();
    const currentMidpoint = midpoint(first, second);
    const scale = clamp(
      active.startScale * distance(first, second) / active.startDistance,
      MIN_SCALE,
      MAX_SCALE,
    );
    const next = {
      scale,
      x: currentMidpoint.x - active.geometry.centerX -
        active.contentAnchor.x * scale,
      y: currentMidpoint.y - active.geometry.centerY -
        active.contentAnchor.y * scale,
    };
    const image = imageRef.current;
    if (!image) return;
    applyTransform(clampTransform(image, active.geometry, next));
  }

  function finishPointer(event: ReactPointerEvent<HTMLImageElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // The browser may already have released an interrupted pointer.
    }
    const active = gesture.current;
    if (!active) return;
    if (pointers.current.size >= 2) {
      if (active.kind === 'pinch' && active.pointerIds.includes(event.pointerId)) {
        beginPinchFromPointers();
      }
      return;
    }
    if (pointers.current.size === 1) {
      const [pointerId, point] = pointers.current.entries().next().value as [number, Point];
      beginSingle(pointerId, point);
      return;
    }
    gesture.current = null;
  }

  return <img
    ref={imageRef}
    className={className ? className + ' image-zoom-image' : 'image-zoom-image'}
    src={src}
    alt={alt}
    style={{ transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})` }}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={finishPointer}
    onPointerCancel={finishPointer}
    onLostPointerCapture={finishPointer}
  />;
}
