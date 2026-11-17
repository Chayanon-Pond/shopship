"use client";

import { clsx } from "clsx";
import { Check, Copy, Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "./fx";

export const EASE = [0.22, 1, 0.36, 1] as const;

/* ------------------------------------------------------------------ Reveal (scroll-in, staggered) */
/*
 * CSS-driven (globals.css `[data-reveal]`): one shared IntersectionObserver flips `data-shown` once, the browser runs the
 * opacity/transform transition on the compositor. No React state, no JS animation per tile. Reduced motion / no-JS:
 * shown immediately (globals.css).
 */
let revealIO: IntersectionObserver | null = null;
function revealObserver() {
  if (!revealIO) {
    revealIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-shown", "");
          revealIO?.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
  }
  return revealIO;
}
/** Sets `data-shown` on the element the first time it scrolls into view. */
export function useRevealOnce<T extends Element>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.setAttribute("data-shown", "");
      return;
    }
    const io = revealObserver();
    io.observe(el);
    return () => io.unobserve(el);
  }, []);
  return ref;
}

export function Reveal({
  children,
  delay = 0,
  className,
  y = 28,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  y?: number;
  as?: "div" | "li" | "section";
}) {
  const ref = useRevealOnce<HTMLElement>();
  const T = as as "div";
  return (
    <T
      ref={ref as React.RefObject<HTMLDivElement>}
      data-reveal=""
      className={className}
      style={{ ["--reveal-y" as string]: `${y}px`, ["--reveal-delay" as string]: `${delay}s` }}
    >
      {children}
    </T>
  );
}

/* ------------------------------------------------------------------ clock (no Date.now() during prerender) */
const clockSubs = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
let clockNow = 0;
function subscribeClock(cb: () => void) {
  clockSubs.add(cb);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockSubs.forEach((f) => f());
    }, 1000);
  }
  return () => {
    clockSubs.delete(cb);
    if (!clockSubs.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
/** Ticks every second in the browser; 0 on the server / first paint. */
export function useNow() {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow || (clockNow = Date.now()),
    () => 0,
  );
}

/**
 * `null` on the server / first paint, then whether `iso` is still in the future. Subscribes to the same 1 s clock but
 * only re-renders the caller when the answer flips (a whole page using this does not re-render every second).
 */
export function useBefore(iso: string | null | undefined) {
  const t = iso ? new Date(iso).getTime() : NaN;
  return useSyncExternalStore(
    subscribeClock,
    () => (Number.isNaN(t) ? null : (clockNow || (clockNow = Date.now())) < t),
    () => null,
  );
}

/* ------------------------------------------------------------------ Flip countdown */
// CSS keyframes (globals.css `.flip-in`): a changed digit remounts (key) and flips in on the compositor.
function FlipDigit({ d, dark }: { d: string; dark?: boolean }) {
  return (
    <span
      className={clsx(
        "relative inline-flex h-[1.6em] w-[1.05em] items-center justify-center overflow-hidden rounded-[6px] font-semibold tabular-nums",
        dark ? "bg-ink text-white" : "bg-white text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]",
      )}
    >
      <span key={d} className={clsx("absolute inset-0 flex items-center justify-center", d !== "-" && "flip-in")}>
        {d}
      </span>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/10" />
    </span>
  );
}

export function splitDuration(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

export function Countdown({ to, dark, className, label }: { to: string; dark?: boolean; className?: string; label?: string }) {
  const now = useNow();
  const end = new Date(to).getTime();
  const left = now ? end - now : NaN;
  const { d, h, m, s } = splitDuration(Number.isNaN(left) ? 0 : left);
  const parts = [d > 0 ? String(d) : null, String(h).padStart(2, "0"), String(m).padStart(2, "0"), String(s).padStart(2, "0")].filter(
    Boolean,
  ) as string[];
  const text = now ? `${d ? `${d} วัน ` : ""}${h} ชั่วโมง ${m} นาที` : "";
  return (
    <span className={clsx("inline-flex items-center gap-1 text-[15px]", className)} role="timer" aria-label={label ? `${label} ${text}` : text}>
      {now === 0
        ? ["--", "--", "--"].map((p, i) => (
            <span key={i} className="inline-flex items-center gap-[2px]" aria-hidden>
              {i > 0 ? <span className="px-0.5 font-semibold">:</span> : null}
              <FlipDigit d="-" dark={dark} />
              <FlipDigit d="-" dark={dark} />
            </span>
          ))
        : parts.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-[2px]" aria-hidden>
              {i > 0 ? <span className="px-0.5 font-semibold">{d > 0 && i === 1 ? "วัน" : ":"}</span> : null}
              {p.split("").map((ch, j) => (
                <FlipDigit key={j} d={ch} dark={dark} />
              ))}
            </span>
          ))}
    </span>
  );
}

/* ------------------------------------------------------------------ Copy code chip */
export function CopyCode({ code, className, tone = "light" }: { code: string; className?: string; tone?: "light" | "dark" | "accent" }) {
  const [done, setDone] = useState(false);
  const [copiedOnce, setCopiedOnce] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const t = document.createElement("textarea");
      t.value = code;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setCopiedOnce(true);
    setDone(true);
    setTimeout(() => setDone(false), 1800);
  }
  const look = {
    light: "bg-white text-ink ring-1 ring-hairline hover:ring-ink-3",
    dark: "bg-ink text-white hover:bg-black",
    accent: "bg-accent text-white hover:bg-accent-hover",
  }[tone];
  return (
    <button
      type="button"
      onClick={copy}
      className={clsx("group inline-flex min-h-11 items-center gap-3 rounded-pill py-1.5 pl-4 pr-1.5 transition active:scale-[0.96]", look, className)}
      title={`คัดลอกโค้ด ${code}`}
    >
      <span className="font-mono text-[15px] font-semibold tracking-[0.08em]">{code}</span>
      <span
        className={clsx(
          "inline-flex h-8 items-center gap-1 overflow-hidden rounded-pill px-3 text-xs font-semibold transition-colors",
          tone === "light" ? "bg-canvas-alt" : "bg-white/15",
        )}
      >
        {/* key swap remounts the label: it slides up in (CSS), same as the old motion swap */}
        <span key={done ? "ok" : "cp"} className={clsx("inline-flex items-center gap-1", copiedOnce && "fx-rise-in")}>
          {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {done ? "คัดลอกแล้ว" : "คัดลอกโค้ด"}
        </span>
      </span>
      <span className="sr-only" aria-live="polite">
        {done ? "คัดลอกแล้ว" : ""}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ Qty stepper */
export function QtyStepper({
  value,
  onChange,
  min = 1,
  max = 999,
  size = "md",
  disabled,
  label = "จำนวน",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  size?: "sm" | "md";
  disabled?: boolean;
  label?: string;
}) {
  const h = size === "sm" ? "h-9" : "h-11";
  const btn = clsx("grid aspect-square place-items-center rounded-full transition hover:bg-hairline-soft active:scale-90 disabled:opacity-30", h);
  return (
    <div className={clsx("inline-flex items-center rounded-pill bg-canvas-alt p-0.5", disabled && "opacity-50")} role="group" aria-label={label}>
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label="ลดจำนวน">
        <Minus className="size-4" aria-hidden />
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        className="w-10 bg-transparent text-center font-semibold tabular-nums"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          if (n) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label="เพิ่มจำนวน">
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ Sheet / dialog */
export function Sheet({
  open,
  onClose,
  title,
  children,
  side = "center",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  side?: "center" | "bottom";
}) {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const presence = usePresence(open, 400);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const o = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    setTimeout(() => panel.current?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = o;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!hydrated || !presence.mounted) return null;
  const c = presence.closing || undefined;
  // enter = @starting-style (Tailwind `starting:`), exit = data-closing while usePresence keeps it mounted
  return createPortal(
    <div
      data-closing={c}
      className="fixed inset-0 z-[80] flex items-end justify-center transition-opacity duration-300 starting:opacity-0 data-[closing]:opacity-0 sm:items-center"
    >
      <button type="button" aria-label="ปิด" className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-closing={c}
        className={clsx(
          "relative max-h-[90dvh] w-full overflow-y-auto rounded-t-[24px] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop outline-none transition-[transform,opacity] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] sm:max-w-lg sm:rounded-[24px] sm:p-7",
          side === "bottom"
            ? "starting:translate-y-full data-[closing]:translate-y-full"
            : "starting:translate-y-6 starting:scale-[0.98] starting:opacity-0 data-[closing]:translate-y-6 data-[closing]:opacity-0",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="-m-1 grid size-9 shrink-0 place-items-center rounded-full bg-canvas-alt transition hover:bg-hairline-soft" aria-label="ปิด">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Progress (flash sale sold %) */
// The fill grows once when the bar first scrolls into view (CSS transition on `[data-soldbar][data-shown]`).
export function SoldBar({ sold, limit, className, dark }: { sold: number; limit: number; className?: string; dark?: boolean }) {
  const pct = limit > 0 ? Math.min(100, Math.floor((sold * 100) / limit)) : 0;
  const ref = useRevealOnce<HTMLDivElement>();
  const hot = pct >= 70;
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between text-[12px] font-semibold">
        <span className={dark ? "text-white" : "text-sale"}>{pct >= 100 ? "ขายหมดแล้ว" : `ขายแล้ว ${pct}%`}</span>
        {hot && pct < 100 ? <span className={dark ? "text-white/70" : "text-ink-2"}>ใกล้หมด</span> : null}
      </div>
      <div
        ref={ref}
        data-soldbar=""
        className={clsx("relative h-2 overflow-hidden rounded-pill", dark ? "bg-white/15" : "bg-sale-soft")}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`ขายแล้ว ${pct}%`}
      >
        <span
          className="absolute inset-y-0 left-0 origin-left rounded-pill bg-gradient-to-r from-[#ff6a00] to-[#e0115f]"
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
    </div>
  );
}

/** A bar that grows from the left once it scrolls into view (`[data-growbar][data-shown]`, globals.css). */
export function GrowBar({ className, delay = 0 }: { className?: string; delay?: number }) {
  const ref = useRevealOnce<HTMLDivElement>();
  return <div ref={ref} data-growbar="" className={clsx("origin-left", className)} style={{ ["--grow-delay" as string]: `${delay}s` }} />;
}
