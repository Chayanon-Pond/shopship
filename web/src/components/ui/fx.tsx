"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/*
 * Motion-free animation helpers for the storefront's critical path (home / product / category). Animations are CSS
 * (globals.css `fx-*` keyframes, Tailwind `starting:` = @starting-style) or the Web Animations API, so the `motion`
 * runtime is not in these routes' initial JS. Interaction-heavy pages (cart, checkout, account) still use motion.
 */

export const EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";

// One cached MediaQueryList: calling window.matchMedia() during render can force a full style recalc (measured
// ~170 ms at 4x CPU on the home page when it ran in the banner carousel's render).
let reduceMql: MediaQueryList | null = null;
let reduceNow = false;
function mql() {
  if (!reduceMql && typeof window !== "undefined") {
    reduceMql = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceNow = reduceMql.matches;
    reduceMql.addEventListener("change", (e) => (reduceNow = e.matches));
  }
  return reduceMql;
}
function subscribeReduce(cb: () => void) {
  const q = mql();
  q?.addEventListener("change", cb);
  return () => q?.removeEventListener("change", cb);
}
/** true when the visitor prefers reduced motion (false on the server). */
export function useReducedMotionPref() {
  return useSyncExternalStore(
    subscribeReduce,
    () => (mql(), reduceNow),
    () => false,
  );
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && (mql(), reduceNow);
}

/**
 * Mount/unmount with an exit transition: `mounted` stays true for `ms` after `open` turns false while `closing` is
 * true (style the closing state with `data-closing`). Enter transitions use `@starting-style` (`starting:` in Tailwind).
 */
export function usePresence(open: boolean, ms = 300) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [prev, setPrev] = useState(open);
  if (open !== prev) {
    setPrev(open);
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) setClosing(true);
  }
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(
      () => {
        setMounted(false);
        setClosing(false);
      },
      prefersReducedMotion() ? 0 : ms,
    );
    return () => clearTimeout(t);
  }, [closing, ms]);
  return { mounted, closing };
}

/**
 * Cross-slide transition state for carousels: when `index` changes, the previous index is kept (`prev`) until the
 * outgoing slide's CSS animation ends (`done()` from onAnimationEnd). `changed` is false until the first change, so
 * the server-rendered first slide never animates.
 */
export function useSlideChange(index: number) {
  const [shown, setShown] = useState(index);
  const [prev, setPrev] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  if (index !== shown) {
    setPrev(shown);
    setShown(index);
    setChanged(true);
  }
  return { prev, changed, done: () => setPrev(null) };
}
