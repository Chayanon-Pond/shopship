"use client";

import { useRef } from "react";

/**
 * Horizontal swipe for carousels without motion's drag feature (drag pulls in the domMax/projection bundle and
 * measures layout on every frame). The `follow` element tracks the finger with a rubber-band factor and springs back
 * with a CSS transition; `onSwipe(±1)` fires past the distance/velocity threshold. Vertical scrolling stays native
 * (put `touch-pan-y` on the target). `clickGuard` swallows the click that ends a swipe.
 */
export function useSwipe(onSwipe: (dir: 1 | -1) => void, { enabled = true, distance = 55, velocity = 0.4, elastic = 0.2 } = {}) {
  const follow = useRef<HTMLDivElement>(null);
  const s = useRef<{ x: number; y: number; t: number; dx: number; id: number; axis: "x" | "y" | null; moved: boolean } | null>(null);
  const swiped = useRef(false);

  const set = (dx: number, animate: boolean) => {
    const el = follow.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    el.style.transform = dx ? `translate3d(${dx}px,0,0)` : "";
  };

  const handlers = enabled
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          s.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, dx: 0, id: e.pointerId, axis: null, moved: false };
          swiped.current = false;
        },
        onPointerMove: (e: React.PointerEvent) => {
          const g = s.current;
          if (!g || g.id !== e.pointerId) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.axis && Math.hypot(dx, dy) > 8) {
            g.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (g.axis === "x") (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          }
          if (g.axis !== "x") return;
          g.dx = dx;
          g.moved = true;
          set(dx * elastic, false);
        },
        onPointerUp: (e: React.PointerEvent) => {
          const g = s.current;
          s.current = null;
          if (!g || g.axis !== "x") return;
          const v = g.dx / Math.max(1, e.timeStamp - g.t); // px per ms
          set(0, true);
          swiped.current = g.moved;
          if (g.dx < -distance || v < -velocity) onSwipe(1);
          else if (g.dx > distance || v > velocity) onSwipe(-1);
        },
        onPointerCancel: () => {
          s.current = null;
          set(0, true);
        },
        onClickCapture: (e: React.MouseEvent) => {
          if (swiped.current) {
            swiped.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        },
      }
    : {};

  return { follow, handlers };
}
