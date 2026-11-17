import { clsx } from "clsx";
import NextImage from "next/image";
import type { ComponentProps } from "react";
import { formatBaht } from "@/lib/money";
import { thNumber } from "@/lib/intl";

/* ------------------------------------------------------------------ Img */
const MEDIA = (process.env.NEXT_PUBLIC_MEDIA_ORIGIN ?? "").replace(/\/$/, "");
/**
 * next/image wrapper. SVG and images from an origin next/image is not configured
 * for are served unoptimized (remotePatterns for NEXT_PUBLIC_MEDIA_ORIGIN requested
 * from the coordinator); everything else is resized/AVIF'd by Next.
 */
export function Img({ src, alt, className, ...rest }: Omit<ComponentProps<typeof NextImage>, "src"> & { src: string }) {
  const external = /^https?:\/\//.test(src) && !(MEDIA && src.startsWith(MEDIA));
  const unoptimized = rest.unoptimized ?? (src.endsWith(".svg") || external || src.startsWith("data:"));
  return <NextImage src={src || "/placeholder.svg"} alt={alt} className={className} {...rest} unoptimized={unoptimized} />;
}

/* ------------------------------------------------------------------ Price */
/**
 * Public / personal price. `strike` must come from the API (`lowest_30d_satang`):
 * we never invent a compare-at price. It renders only when higher than `value`.
 */
export function Price({
  value,
  strike,
  size = "md",
  sale,
  className,
  from,
}: {
  value: number;
  strike?: number | null;
  size?: "sm" | "md" | "lg" | "xl";
  sale?: boolean;
  className?: string;
  from?: boolean;
}) {
  const show = strike != null && strike > value;
  const sz = { sm: "text-sm", md: "text-base", lg: "text-xl", xl: "text-3xl md:text-4xl" }[size];
  return (
    <span className={clsx("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      <span className={clsx(sz, "font-semibold tabular-nums tracking-tight", (sale || show) && "text-sale")}>
        {from ? <span className="mr-1 text-[0.8em] font-normal text-ink-2">เริ่มต้น</span> : null}
        {formatBaht(value)}
      </span>
      {show ? (
        <s
          className={clsx("tabular-nums text-ink-2", size === "xl" ? "text-lg" : "text-[0.8em]")}
          title="ราคาต่ำสุดใน 30 วันก่อนเริ่มโปรโมชัน"
          aria-label={`ราคาต่ำสุด 30 วันก่อนโปร ${formatBaht(strike!)}`}
        >
          {formatBaht(strike!)}
        </s>
      ) : null}
    </span>
  );
}

export function discountPercent(value: number, strike?: number | null) {
  if (!strike || strike <= value) return 0;
  return Math.floor(((strike - value) * 100) / strike);
}

/* ------------------------------------------------------------------ Stars */
const STAR_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z'/%3E%3C/svg%3E")`;
export function Stars({ value, count, size = 14, className }: { value: number; count?: number; size?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span role="img" className={clsx("inline-flex items-center gap-1 text-ink-2", className)} aria-label={`คะแนน ${value.toFixed(1)} จาก 5${count !== undefined ? ` (${thNumber(count)} รีวิว)` : ""}`}>
      {/* 2 elements instead of 10 SVGs per rating (product grids render dozens of these) */}
      <span
        className="relative inline-block overflow-hidden bg-hairline"
        style={{ width: size * 5, height: size, maskImage: STAR_MASK, WebkitMaskImage: STAR_MASK, maskSize: `${size}px ${size}px`, WebkitMaskSize: `${size}px ${size}px`, maskRepeat: "repeat-x", WebkitMaskRepeat: "repeat-x" }}
        aria-hidden
      >
        <span className="absolute inset-y-0 left-0 bg-[#ff9f0a]" style={{ width: `${pct}%` }} />
      </span>
      {count !== undefined ? <span className="text-xs tabular-nums">({thNumber(count)})</span> : null}
    </span>
  );
}

/* ------------------------------------------------------------------ Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={clsx("shine block rounded-[10px] bg-canvas-alt", className)} />;
}

/* ------------------------------------------------------------------ Section heading */
export function SectionHead({
  eyebrow,
  title,
  sub,
  action,
  id,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 md:mb-8">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-sm font-semibold text-sale">{eyebrow}</p> : null}
        <h2 id={id} className="text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[40px]">
          {title}
        </h2>
        {sub ? <p className="mt-1 text-ink-2 md:text-lg">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Chip / badge */
export function Badge({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "sale" | "accent" | "success" | "dark"; className?: string }) {
  const t = {
    neutral: "bg-canvas-alt text-ink",
    sale: "bg-sale-soft text-sale",
    accent: "bg-accent-soft text-link",
    success: "bg-[#e9f6ee] text-success",
    dark: "bg-ink text-white",
  }[tone];
  return <span className={clsx("inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-semibold", t, className)}>{children}</span>;
}
