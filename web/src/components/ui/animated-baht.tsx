"use client";

import { clsx } from "clsx";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { formatBaht } from "@/lib/money";
import { EASE } from "./motion";

/* Animated money (own module: `animate` pulls in the full animation engine, keep it off the shared motion chunk) */
export function AnimatedBaht({ value, className, signed }: { value: number; className?: string; signed?: "minus" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = (v: number) => (signed === "minus" && v > 0 ? "−" : "") + formatBaht(Math.round(v));
    if (reduce || prev.current === value) {
      el.textContent = fmt(value);
      prev.current = value;
      return;
    }
    const c = animate(prev.current, value, {
      duration: 0.6,
      ease: EASE,
      onUpdate: (v) => (el.textContent = fmt(v)),
    });
    prev.current = value;
    return () => c.stop();
  }, [value, reduce, signed]);
  return (
    <span ref={ref} className={clsx("tabular-nums", className)}>
      {(signed === "minus" && value > 0 ? "−" : "") + formatBaht(value)}
    </span>
  );
}
