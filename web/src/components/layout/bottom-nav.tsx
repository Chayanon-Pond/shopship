"use client";

import { clsx } from "clsx";
import { House, LayoutGrid, Tag, User } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/store/cart";
import { useSession } from "@/components/store/session";
import { CartBadgeIcon } from "./header";

const HIDE = [/^\/p\//, /^\/checkout/, /^\/cart$/];

/** Mobile/tablet-portrait tab bar (หน้าแรก / หมวดหมู่ / ตะกร้า / บัญชี) with a raised floating cart. Must render inside <Suspense> (usePathname). */
export function BottomNav() {
  const path = usePathname();
  const { me } = useSession();
  const { count } = useCart();
  if (HIDE.some((r) => r.test(path))) return null;
  const tab = (href: string, label: string, Icon: typeof House | typeof Tag, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx("flex flex-1 flex-col items-center gap-0.5 pt-2 text-[10.5px] font-medium transition active:scale-95", active ? "text-accent" : "text-ink-2")}
    >
      <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
      {label}
    </Link>
  );
  return (
    <>
      <div className="h-[calc(64px+env(safe-area-inset-bottom))] md:hidden" aria-hidden />
      <nav
        data-bottom-nav=""
        aria-label="แถบนำทาง"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-hairline-soft bg-white/85 backdrop-blur-xl backdrop-saturate-[1.8] md:hidden"
      >
        <div className="mx-auto flex h-14 max-w-md items-stretch px-2">
          {tab("/", "หน้าแรก", House, path === "/")}
          {tab("/categories", "หมวดหมู่", LayoutGrid, path.startsWith("/categories") || path.startsWith("/c/"))}
          <div className="relative flex flex-1 justify-center">
            <Link
              href="/cart"
              aria-label={`ตะกร้า ${count} ชิ้น`}
              className="absolute -top-6 grid size-[56px] place-items-center rounded-full bg-ink text-white shadow-[0_8px_24px_rgb(0_0_0/0.22)] ring-4 ring-white transition active:scale-90"
            >
              <CartBadgeIcon size={22} />
            </Link>
            <span className="mt-auto pb-1 text-[10.5px] font-medium text-ink-2">ตะกร้า</span>
          </div>
          {tab("/promotions", "โปรโมชัน", Tag, path.startsWith("/promotions") || path.startsWith("/campaign"))}
          {tab(me ? "/account" : "/login", "บัญชี", User, path.startsWith("/account") || path === "/login")}
        </div>
      </nav>
    </>
  );
}
