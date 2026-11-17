"use client";

/**
 * Back-office UI primitives (white Apple-like tokens from globals.css, denser than the storefront).
 * Owner: admin agent.
 */
import clsx from "clsx";
import { ChevronLeft, ChevronRight, Inbox, Loader2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

// ---------- buttons ----------
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "danger-ghost";
type BtnSize = "sm" | "md" | "lg";
const btnBase =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 select-none";
const btnVariant: Record<BtnVariant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-hover",
  secondary: "bg-canvas-alt text-ink hover:bg-hairline-soft",
  outline: "border border-hairline bg-surface text-ink hover:bg-canvas-alt",
  ghost: "text-ink hover:bg-canvas-alt",
  danger: "bg-[var(--danger)] text-white hover:opacity-90",
  "danger-ghost": "text-danger hover:bg-[#fdecee]",
};
const btnSize: Record<BtnSize, string> = {
  sm: "h-8 rounded-[8px] px-3 text-[13px]",
  md: "h-10 rounded-[var(--radius-input)] px-4 text-sm",
  lg: "h-14 rounded-[14px] px-6 text-base",
};
export function btnClass(variant: BtnVariant = "secondary", size: BtnSize = "md", className?: string) {
  return clsx(btnBase, btnVariant[variant], btnSize[size], className);
}
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize; loading?: boolean; icon?: LucideIcon }>(
  function Button({ variant = "secondary", size = "md", loading, icon: Icon, className, children, disabled, type = "button", ...rest }, ref) {
    return (
      <button ref={ref} type={type} className={btnClass(variant, size, className)} disabled={disabled || loading} {...rest}>
        {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
export function LinkButton({ href, variant = "secondary", size = "md", icon: Icon, className, children }: { href: string; variant?: BtnVariant; size?: BtnSize; icon?: LucideIcon; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={btnClass(variant, size, className)}>
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </Link>
  );
}
export function IconButton({ label, icon: Icon, className, size = "md", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-input)] text-ink-2 transition-colors hover:bg-canvas-alt hover:text-ink disabled:opacity-40",
        size === "sm" ? "size-8" : "size-10",
        className,
      )}
      {...rest}
    >
      <Icon className="size-[18px]" aria-hidden />
    </button>
  );
}

// ---------- layout ----------
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-1 inline-flex items-center gap-0.5 text-[13px] text-link hover:underline">
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
export function Card({ className, children, title, actions, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; pad?: boolean }) {
  return (
    <section className={clsx("rounded-[var(--radius-card)] border border-hairline-soft bg-surface shadow-[var(--shadow-tile)]", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-2 border-b border-hairline-soft px-4 py-3">
          {title ? <h2 className="text-[15px] font-semibold text-ink">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className={pad ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

// ---------- badges ----------
export type Tone = "neutral" | "blue" | "green" | "orange" | "red" | "purple";
const toneCls: Record<Tone, string> = {
  neutral: "bg-canvas-alt text-ink-2",
  blue: "bg-accent-soft text-link",
  green: "bg-[#e9f6ec] text-success",
  orange: "bg-sale-soft text-sale",
  red: "bg-[#fdecee] text-danger",
  purple: "bg-[#f3eefc] text-[#6e3fbf]",
};
export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", toneCls[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

// ---------- form ----------
export function Field({ label, error, hint, children, className, htmlFor, required }: { label?: ReactNode; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string; required?: boolean }) {
  return (
    <div className={clsx("flex min-w-0 flex-col gap-1", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}
/** Inputs are full width unless the caller passes its own w-* class (no tailwind-merge in this repo). */
const widthOf = (className?: string) => (/(^|\s)w-/.test(className ?? "") ? "" : "w-full");
const inputCls =
  "min-h-10 rounded-[var(--radius-input)] border border-hairline bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-soft disabled:bg-canvas-alt disabled:text-ink-2 aria-[invalid=true]:border-danger";
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; prefix?: string; suffix?: string }>(function Input(
  { className, invalid, prefix, suffix, ...rest },
  ref,
) {
  if (prefix || suffix)
    return (
      <div className={clsx("relative flex items-center", widthOf(className), className)}>
        {prefix ? <span className="pointer-events-none absolute left-3 text-sm text-ink-2">{prefix}</span> : null}
        <input ref={ref} aria-invalid={invalid || undefined} className={clsx(inputCls, "w-full", prefix && "pl-7", suffix && "pr-9")} {...rest} />
        {suffix ? <span className="pointer-events-none absolute right-3 text-sm text-ink-2">{suffix}</span> : null}
      </div>
    );
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(inputCls, widthOf(className), className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={clsx(inputCls, widthOf(className), "min-h-24 py-2 leading-relaxed", className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={clsx(inputCls, widthOf(className), "appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236e6e73' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});
export function Switch({ checked, onChange, label, disabled, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <label htmlFor={id} className="min-w-0 text-sm">
        <span className="font-medium text-ink">{label}</span>
        {description ? <span className="block text-xs text-ink-2">{description}</span> : null}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40", checked ? "bg-success" : "bg-hairline")}
      >
        <span className={clsx("absolute top-[3px] size-5 rounded-full bg-white shadow transition-[left] duration-200", checked ? "left-[21px]" : "left-[3px]")} />
      </button>
    </div>
  );
}
export function Checkbox({ checked, onChange, label, className, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string; indeterminate?: boolean }) {
  return (
    <label className={clsx("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input
        type="checkbox"
        className="size-[18px] cursor-pointer accent-[var(--accent)]"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = Boolean(indeterminate);
        }}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={typeof label === "string" ? undefined : "เลือก"}
      />
      {label}
    </label>
  );
}
export function Segmented<T extends string>({ value, onChange, options, size = "md", className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md"; className?: string }) {
  return (
    <div role="radiogroup" className={clsx("inline-flex rounded-[10px] bg-canvas-alt p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "rounded-[8px] px-3 font-medium transition-[background-color,color,box-shadow] duration-150",
            size === "sm" ? "h-7 text-xs" : "h-8 text-[13px]",
            value === o.value ? "bg-surface text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- states ----------
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("shine rounded-[8px] bg-canvas-alt", className)} aria-hidden />;
}
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-hairline-soft" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={clsx("h-4", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}
export function EmptyState({ icon: Icon = Inbox, title, body, action }: { icon?: LucideIcon; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-canvas-alt text-ink-2">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="font-medium text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-ink-2">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-sm text-danger">{message}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry}>
          ลองใหม่
        </Button>
      ) : null}
    </div>
  );
}
export function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <nav aria-label="เปลี่ยนหน้า" className="flex items-center justify-between gap-3 border-t border-hairline-soft px-4 py-3 text-[13px] text-ink-2">
      <span>
        ทั้งหมด {total.toLocaleString("th-TH")} รายการ · หน้า {page}/{totalPages}
      </span>
      <div className="flex items-center gap-1">
        <IconButton size="sm" label="หน้าก่อน" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} />
        <IconButton size="sm" label="หน้าถัดไป" icon={ChevronRight} disabled={page >= totalPages} onClick={() => onPage(page + 1)} />
      </div>
    </nav>
  );
}

// ---------- table ----------
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" | "center" }) {
  return (
    <th scope="col" className={clsx("whitespace-nowrap border-b border-hairline-soft bg-surface-2 px-4 py-2.5 text-left text-xs font-medium text-ink-2", align === "right" && "text-right", align === "center" && "text-center", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, align, colSpan }: { children?: ReactNode; className?: string; align?: "right" | "center"; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={clsx("border-b border-hairline-soft px-4 py-3 align-middle", align === "right" && "text-right tabular-nums", align === "center" && "text-center", className)}>
      {children}
    </td>
  );
}

// ---------- data viz ----------
export function Sparkline({ values, className, height = 40 }: { values: number[]; className?: string; height?: number }) {
  const w = 160;
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 4 - (v / max) * (height - 8)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={clsx("w-full", className)} style={{ height }} aria-hidden>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill="var(--accent-soft)" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3" fill="var(--accent)" />
    </svg>
  );
}
export function Progress({ value, max, tone = "blue", className, label }: { value: number; max: number; tone?: "blue" | "orange" | "green"; className?: string; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-canvas-alt", className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className={clsx("h-full rounded-full transition-[width] duration-500", tone === "orange" ? "bg-sale" : tone === "green" ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
    </div>
  );
}
export function Stat({ label, value, sub, icon: Icon, children }: { label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; children?: ReactNode }) {
  return (
    <div className="flex flex-col rounded-[var(--radius-card)] border border-hairline-soft bg-surface p-4 shadow-[var(--shadow-tile)]">
      <div className="flex items-center justify-between text-[13px] text-ink-2">
        <span>{label}</span>
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-2">{sub}</div> : null}
      {children}
    </div>
  );
}

/** Suspense fallback for admin pages. */
export function PageFallback() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลด">
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-6 h-4 w-80" />
      <div className="rounded-[var(--radius-card)] border border-hairline-soft bg-surface">
        <TableSkeleton />
      </div>
    </div>
  );
}
