"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Children, isValidElement, useCallback, useEffect, useRef, useState } from "react";

/**
 * Apple Store-style horizontal shelf: one row that scrolls with native momentum + scroll-snap. The first card lines
 * up with the page container's left edge while the row bleeds to the viewport's right edge (globals.css `.shelf`).
 * Round prev/next paddles sit under the row on the right (md and up; touch/trackpad swipe everywhere).
 *
 * Children are the cards; each is wrapped in an `<li>` (keys are kept). `itemClassName` sets the card width.
 */
export function Shelf({
  label,
  children,
  itemClassName = "shelf-card",
  className,
}: {
  /** accessible name of the row, e.g. "สินค้า Flash Sale" */
  label: string;
  children: React.ReactNode;
  itemClassName?: string;
  className?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean; scrollable: boolean }>({ start: true, end: false, scrollable: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const x = Math.abs(el.scrollLeft);
    const next = { start: x <= 2, end: x >= max - 2, scrollable: max > 2 };
    setEdge((p) => (p.start === next.start && p.end === next.end && p.scrollable === next.scrollable ? p : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  /**
   * One card per click, with an eased glide (Apple Store feel). Rapid clicks queue up: each click moves the target one
   * more card and the running glide retargets smoothly. Scroll-snap is paused during the glide so it can't fight it.
   */
  const anim = useRef<{ raf: number; target: number } | null>(null);
  useEffect(() => () => cancelAnimationFrame(anim.current?.raf ?? 0), []);
  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(":scope > li");
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const card = first ? first.offsetWidth + gap : el.clientWidth;
    const max = el.scrollWidth - el.clientWidth;
    const from = el.scrollLeft;
    const base = anim.current ? anim.current.target : Math.round(from / card) * card;
    const target = Math.min(max, Math.max(0, base + dir * card));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.scrollLeft = target;
      return;
    }
    cancelAnimationFrame(anim.current?.raf ?? 0);
    const start = performance.now();
    const duration = 520;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    el.style.scrollSnapType = "none";
    el.style.scrollBehavior = "auto";
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      el.scrollLeft = from + (target - from) * ease(t);
      if (t < 1) {
        anim.current = { raf: requestAnimationFrame(tick), target };
      } else {
        anim.current = null;
        el.style.scrollSnapType = "";
        el.style.scrollBehavior = "";
      }
    };
    anim.current = { raf: requestAnimationFrame(tick), target };
  };

  const items = Children.toArray(children).filter(isValidElement);
  const paddle =
    "grid size-9 cursor-pointer place-items-center rounded-full bg-hairline-soft text-ink transition-colors duration-200 hover:bg-hairline active:scale-95 disabled:cursor-default disabled:bg-canvas-alt disabled:text-ink-3 disabled:active:scale-100";

  return (
    <div className={className} role="region" aria-roledescription="ชั้นวางสินค้า" aria-label={label}>
      {/* Extra block padding (cancelled by negative margin, so layout is unchanged) gives the hover lift + shadow room:
          an overflow-x scroller clips vertically too. Inline style because `.shelf` padding in globals.css is unlayered. */}
      <ul ref={ref} className="shelf no-scrollbar" style={{ paddingBlock: "14px 30px", marginBlock: "-14px -30px" }}>
        {items.map((child) => (
          <li
            key={child.key}
            className={clsx(
              itemClassName,
              // Apple Store hover: the card rises a touch and its shadow deepens (mouse/trackpad only — Tailwind 4 hover
              // is (hover: hover)-gated, so touch devices never get a stuck state)
              "transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:-translate-y-1 hover:scale-[1.02]",
              "[&>*]:shadow-[0_2px_12px_-6px_rgb(0_0_0/0.10)] [&>*]:transition-shadow [&>*]:duration-500 hover:[&>*]:shadow-[0_22px_44px_-16px_rgb(0_0_0/0.28)]",
              "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100",
            )}
          >
            {child}
          </li>
        ))}
      </ul>
      <div className={clsx("container-page mt-4 hidden justify-end gap-3 md:flex", !edge.scrollable && "invisible")}>
        <button type="button" className={paddle} onClick={() => step(-1)} disabled={edge.start} aria-label={`เลื่อน${label}ไปทางซ้าย`}>
          <ChevronLeft className="size-5" strokeWidth={2.2} aria-hidden />
        </button>
        <button type="button" className={paddle} onClick={() => step(1)} disabled={edge.end} aria-label={`เลื่อน${label}ไปทางขวา`}>
          <ChevronRight className="size-5" strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </div>
  );
}
