import { clsx } from "clsx";

/** ShopShip mark: a rounded bag whose fold forms a forward "ship" arrow. Own identity (blue, not orange). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={clsx("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="ssg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2997ff" />
          <stop offset="1" stopColor="#0058d6" />
        </linearGradient>
      </defs>
      <rect x="2" y="7" width="28" height="23" rx="8" fill="url(#ssg)" />
      <path d="M11 9.5V8a5 5 0 0 1 10 0v1.5" fill="none" stroke="#1d1d1f" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9.5 18.5h12m-4.2-4.2 4.2 4.2-4.2 4.2" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 font-semibold tracking-[-0.02em]", className)}>
      <LogoMark className="size-7" />
      <span className="text-[19px] leading-none">ShopShip</span>
    </span>
  );
}
