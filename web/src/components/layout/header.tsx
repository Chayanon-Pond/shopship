"use client";

import { clsx } from "clsx";
import { Heart, ShoppingBag, User, Zap } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { useEffect, useState } from "react";
import { useCart } from "@/components/store/cart";
import { useSession } from "@/components/store/session";
import { useWishlist } from "@/components/store/personal";
import { Logo } from "./logo";
import { SearchButton } from "./search";

export type NavCategory = { slug: string; name: string; children: { slug: string; name: string }[] };

export function CartBadgeIcon({ className, size = 20 }: { className?: string; size?: number }) {
  const { count, bump, registerTarget } = useCart();
  return (
    <span ref={registerTarget} className={clsx("relative inline-grid place-items-center", className)}>
      {/* bump > 0 after an add: the bag wiggles and the count pops (CSS keyframes, keyed to restart) */}
      <span key={`b${bump}`} className={clsx("inline-grid", bump > 0 && "fx-bag-bump")}>
        <ShoppingBag width={size} height={size} aria-hidden />
      </span>
      {count > 0 ? (
        <span
          key={`c${bump}`}
          className={clsx(
            "absolute -right-2 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-pill bg-accent px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-white tabular-nums",
            bump > 0 && "fx-count-pop",
          )}
        >
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </span>
  );
}

export function Header({ categories }: { categories: NavCategory[] }) {
  const { me } = useSession();
  const { count } = useCart();
  const wish = useWishlist();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    const r = requestAnimationFrame(on);
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(r);
      window.removeEventListener("scroll", on);
    };
  }, []);

  return (
    <header className="sticky top-0 z-50">
      <div
        className={clsx(
          "border-b bg-white/80 backdrop-blur-xl backdrop-saturate-[1.8] transition-[border-color,background-color] duration-300",
          scrolled ? "border-hairline-soft bg-white/72" : "border-transparent",
        )}
      >
        <div className="container-page flex h-[52px] items-center gap-3 md:gap-6">
          <Link href="/" aria-label="ShopShip หน้าแรก" className="shrink-0 transition-opacity hover:opacity-80">
            <Logo />
          </Link>
          <nav aria-label="เมนูหลัก" className="hidden items-center gap-6 text-[13px] text-ink/85 lg:flex">
            <Link href="/flash-sale" className="inline-flex items-center gap-1 font-medium text-sale transition hover:opacity-80">
              <Zap className="size-3.5" fill="currentColor" aria-hidden /> Flash Sale
            </Link>
            <Link href="/promotions" className="transition hover:text-ink">
              โปรโมชัน
            </Link>
            {categories.slice(0, 4).map((c) => (
              <Link key={c.slug} href={`/c/${c.slug}`} className="transition hover:text-ink">
                {c.name}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1 md:gap-2">
            <div className="hidden min-w-0 flex-1 justify-end md:flex">
              <SearchButton variant="pill" />
            </div>
            <div className="md:hidden">
              <SearchButton variant="icon" />
            </div>
            <Link
              href="/account/wishlist"
              className="relative hidden size-10 place-items-center rounded-full transition hover:bg-canvas-alt md:grid"
              aria-label={`รายการโปรด${wish.count ? ` ${wish.count} รายการ` : ""}`}
            >
              <Heart className="size-[19px]" aria-hidden />
              {wish.count ? <span className="absolute right-2 top-2 size-2 rounded-full bg-sale ring-2 ring-white" /> : null}
            </Link>
            <Link
              href={me ? "/account" : "/login"}
              className="hidden h-10 items-center gap-2 rounded-pill px-2.5 text-sm transition hover:bg-canvas-alt md:flex"
              aria-label={me ? `บัญชีของ ${me.name}` : "เข้าสู่ระบบ"}
            >
              <User className="size-[19px]" aria-hidden />
              <span className="hidden max-w-[9rem] truncate xl:inline">{me ? me.name.split(" ")[0] : "เข้าสู่ระบบ"}</span>
            </Link>
            <Link href="/cart" className="grid size-10 place-items-center rounded-full transition hover:bg-canvas-alt" aria-label={`ตะกร้าสินค้า ${count} ชิ้น`}>
              <CartBadgeIcon />
            </Link>
          </div>
        </div>
      </div>
      <CategoryBar categories={categories} scrolled={scrolled} />
    </header>
  );
}

function CategoryBar({ categories, scrolled }: { categories: NavCategory[]; scrolled: boolean }) {
  const items = [
    { href: "/flash-sale", label: "Flash Sale", hot: true },
    { href: "/promotions", label: "โค้ดส่วนลด", hot: false },
    ...categories.flatMap((c) => [{ href: `/c/${c.slug}`, label: c.name, hot: false }, ...c.children.map((ch) => ({ href: `/c/${ch.slug}`, label: ch.name, hot: false }))]),
  ];
  return (
    <div
      className={clsx(
        "border-b bg-white/72 backdrop-blur-xl backdrop-saturate-[1.8] transition-colors duration-300",
        scrolled ? "border-hairline-soft" : "border-hairline-soft/60",
      )}
    >
      <nav aria-label="หมวดหมู่" className="container-page no-scrollbar h-11 overflow-x-auto [mask-image:linear-gradient(90deg,#000_92%,transparent)] xl:[mask-image:none]">
        <div className="mx-auto flex h-full w-max items-center gap-1">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
           
            className={clsx(
              "shrink-0 whitespace-nowrap rounded-pill px-3 py-1.5 text-[13px] transition active:scale-95",
              it.hot ? "font-semibold text-sale hover:bg-sale-soft" : "text-ink/80 hover:bg-canvas-alt hover:text-ink",
            )}
          >
            {it.label}
          </Link>
        ))}
        </div>
      </nav>
    </div>
  );
}
