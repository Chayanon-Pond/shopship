"use client";

/**
 * Console chrome + session gate: GET /auth/me → 401 ⇒ /admin/login?next=…, customer ⇒ 403 page.
 * Sidebar: full on desktop (collapsible), icon rail on iPad portrait, drawer on phones.
 */
import clsx from "clsx";
import {
  Boxes,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  FolderTree,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Package,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { adminLogout, getAdminMe } from "@/lib/api/admin";
import type { Me, Perm } from "@/lib/api/types";
import { ROLE_LABEL } from "@/lib/admin/format";
import { OverlayProvider } from "./overlay";
import { GlobalSearch } from "./search";
import { SessionCtx } from "./session";
import { Button, LinkButton, Skeleton } from "./ui";

type NavItem = { href: string; label: string; icon: LucideIcon; perm: Perm; star?: boolean; match?: string[] };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "", items: [{ href: "/admin", label: "แดชบอร์ด", icon: LayoutDashboard, perm: "dashboard:read" }] },
  {
    group: "การขาย",
    items: [
      { href: "/admin/orders", label: "คำสั่งซื้อ", icon: ClipboardList, perm: "orders:read" },
      { href: "/admin/packing", label: "แพ็คของ", icon: PackageCheck, perm: "orders:fulfil" },
      { href: "/admin/customers", label: "ลูกค้า", icon: Users, perm: "customers:read" },
    ],
  },
  {
    group: "แคตตาล็อก",
    items: [
      { href: "/admin/products", label: "สินค้า", icon: Package, perm: "catalog:read" },
      { href: "/admin/categories", label: "หมวดหมู่", icon: FolderTree, perm: "catalog:read" },
      { href: "/admin/inventory", label: "สต็อก", icon: Boxes, perm: "catalog:read" },
    ],
  },
  {
    group: "การตลาด",
    items: [
      { href: "/admin/promotions", label: "โปรโมชัน", icon: Sparkles, perm: "promotions:read", star: true, match: ["/admin/campaigns", "/admin/flash-sales", "/admin/customer-groups"] },
      { href: "/admin/banners", label: "แบนเนอร์", icon: ImageIcon, perm: "banners:write" },
      { href: "/admin/reviews", label: "รีวิว", icon: MessageSquareText, perm: "reviews:moderate" },
    ],
  },
  {
    group: "ระบบ",
    items: [
      { href: "/admin/staff", label: "ผู้ใช้หลังร้าน", icon: ShieldCheck, perm: "customers:read" },
      { href: "/admin/audit", label: "บันทึกการใช้งาน", icon: ScrollText, perm: "audit:read" },
      { href: "/admin/settings", label: "ตั้งค่า", icon: Settings, perm: "dashboard:read" },
    ],
  },
];

const COLLAPSE_KEY = "shopship_admin_sidebar_collapsed";

export function ConsoleShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [gate, setGate] = useState<"loading" | "ok" | "forbidden" | "error">("loading");
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  });

  useEffect(() => {
    let alive = true;
    getAdminMe().then(
      (m) => {
        if (!alive) return;
        setMe(m);
        setGate(m.role === "customer" ? "forbidden" : "ok");
      },
      (e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) router.replace(`/admin/login?next=${encodeURIComponent(pathRef.current)}`);
        else if (e instanceof ApiError && e.status === 403) setGate("forbidden");
        else setGate("error");
      },
    );
    return () => {
      alive = false;
    };
  }, [router]);

  // close the phone drawer on navigation
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (drawer) setDrawer(false);
  }

  const logout = useCallback(() => {
    adminLogout().finally(() => router.replace("/admin/login"));
  }, [router]);
  const session = useMemo(() => (me ? { me, can: (p: Perm) => me.perms.includes(p), logout } : null), [me, logout]);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  if (gate === "loading" || (gate === "ok" && !session)) return <ShellSkeleton />;
  if (gate === "forbidden") return <Forbidden onLogout={logout} />;
  if (gate === "error")
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-ink">เชื่อมต่อระบบหลังร้านไม่ได้</p>
        <Button onClick={() => location.reload()}>ลองใหม่</Button>
      </div>
    );

  const items = NAV.map((g) => ({ ...g, items: g.items.filter((i) => session!.can(i.perm)) })).filter((g) => g.items.length);
  const isActive = (i: NavItem) => (i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href) || Boolean(i.match?.some((m) => pathname.startsWith(m))));

  const nav = (mode: "full" | "rail") => (
    <nav aria-label="เมนูหลังร้าน" className="flex flex-col gap-4 px-2.5 pb-4">
      {items.map((g) => (
        <div key={g.group || "top"}>
          {g.group && mode === "full" ? <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">{g.group}</p> : g.group ? <div className="mx-3 mb-2 border-t border-hairline-soft" /> : null}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => {
              const active = isActive(i);
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    title={mode === "rail" ? i.label : undefined}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "group flex items-center gap-2.5 rounded-[9px] text-[14px] transition-colors duration-150",
                      mode === "rail" ? "h-11 justify-center" : "h-10 px-2.5",
                      active ? "bg-accent-soft font-medium text-link" : "text-ink hover:bg-canvas-alt",
                    )}
                  >
                    <i.icon className={clsx("size-[18px] shrink-0", active ? "text-link" : i.star ? "text-sale" : "text-ink-2")} aria-hidden />
                    {mode === "full" ? <span className="truncate">{i.label}</span> : <span className="sr-only">{i.label}</span>}
                    {mode === "full" && i.star ? <span className="ml-auto rounded-full bg-sale-soft px-1.5 text-[10px] font-semibold text-sale">HUB</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  const brand = (short: boolean) => (
    <Link href="/admin" className="flex h-14 items-center gap-2 px-4 font-semibold tracking-tight text-ink">
      <span className="flex size-7 items-center justify-center rounded-[8px] bg-ink text-[13px] font-bold text-white">S</span>
      {short ? null : (
        <span>
          ShopShip <span className="font-normal text-ink-2">หลังร้าน</span>
        </span>
      )}
    </Link>
  );

  return (
    <SessionCtx.Provider value={session}>
      <OverlayProvider>
        <div className="flex min-h-dvh">
          {/* desktop / iPad sidebar */}
          <aside className={clsx("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-hairline-soft bg-surface transition-[width] duration-200 md:flex", collapsed ? "w-[68px]" : "w-[68px] lg:w-[232px]")}>
            <div className={clsx(collapsed ? "" : "lg:hidden")}>{brand(true)}</div>
            <div className={clsx("hidden", !collapsed && "lg:block")}>{brand(false)}</div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
              <div className={clsx(collapsed ? "" : "lg:hidden")}>{nav("rail")}</div>
              <div className={clsx("hidden", !collapsed && "lg:block")}>{nav("full")}</div>
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              className="hidden h-11 items-center gap-2 border-t border-hairline-soft px-5 text-[13px] text-ink-2 hover:text-ink lg:flex"
              aria-label={collapsed ? "ขยายเมนู" : "ย่อเมนู"}
            >
              {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
              {collapsed ? null : "ย่อเมนู"}
            </button>
          </aside>

          {/* phone drawer */}
          {drawer ? (
            <div className="fixed inset-0 z-[60] md:hidden">
              <div className="absolute inset-0 animate-[fade-in_180ms_ease-out] bg-[var(--overlay)]" onClick={() => setDrawer(false)} aria-hidden />
              <aside className="absolute inset-y-0 left-0 flex w-[84%] max-w-[300px] animate-[drawer-in_220ms_var(--ease-out)] flex-col bg-surface shadow-[var(--shadow-pop)]" aria-label="เมนู">
                <div className="flex items-center justify-between pr-2">
                  {brand(false)}
                  <button type="button" onClick={() => setDrawer(false)} className="flex size-10 items-center justify-center rounded-[10px] text-ink-2 hover:bg-canvas-alt" aria-label="ปิดเมนู">
                    <X className="size-5" aria-hidden />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{nav("full")}</div>
              </aside>
              <style>{`@keyframes drawer-in{from{transform:translateX(-100%)}to{transform:none}}`}</style>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-hairline-soft bg-surface/85 px-3 backdrop-blur-xl md:px-5">
              <button type="button" onClick={() => setDrawer(true)} className="flex size-10 items-center justify-center rounded-[10px] text-ink hover:bg-canvas-alt md:hidden" aria-label="เปิดเมนู">
                <Menu className="size-5" aria-hidden />
              </button>
              <GlobalSearch />
              <div className="ml-auto flex items-center gap-1">
                <a href="/" target="_blank" rel="noreferrer" className="hidden h-9 items-center gap-1 rounded-[9px] px-2.5 text-[13px] text-ink-2 hover:bg-canvas-alt hover:text-ink sm:inline-flex">
                  ดูหน้าร้าน <ExternalLink className="size-3.5" aria-hidden />
                </a>
                <UserMenu me={session!.me} onLogout={logout} />
              </div>
            </header>
            <main id="admin-main" className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-5 md:px-6 md:py-6">
              {children}
            </main>
          </div>
        </div>
      </OverlayProvider>
    </SessionCtx.Provider>
  );
}

function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const initial = me.email.slice(0, 1).toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" className="flex h-10 items-center gap-2 rounded-[10px] pl-1 pr-2 hover:bg-canvas-alt">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-link">{initial}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[140px] truncate text-[13px] font-medium text-ink">{me.name || me.email}</span>
          <span className="block text-[11px] text-ink-2">{ROLE_LABEL[me.role]}</span>
        </span>
        <ChevronDown className="size-4 text-ink-2" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-12 z-50 w-60 animate-[toast-in_160ms_var(--ease-out)] rounded-[12px] border border-hairline-soft bg-surface p-1.5 shadow-[var(--shadow-pop)]">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-ink">{me.name}</p>
            <p className="truncate text-xs text-ink-2">{me.email}</p>
          </div>
          <div className="my-1 border-t border-hairline-soft" />
          <Link role="menuitem" href="/admin/settings" onClick={() => setOpen(false)} className="flex h-10 items-center gap-2 rounded-[8px] px-3 text-sm text-ink hover:bg-canvas-alt">
            <Settings className="size-4 text-ink-2" aria-hidden /> ตั้งค่าร้าน
          </Link>
          <button role="menuitem" type="button" onClick={onLogout} className="flex h-10 w-full items-center gap-2 rounded-[8px] px-3 text-sm text-danger hover:bg-canvas-alt">
            <LogOut className="size-4" aria-hidden /> ออกจากระบบ
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="กำลังตรวจสอบสิทธิ์">
      <div className="hidden w-[232px] shrink-0 border-r border-hairline-soft bg-surface p-4 lg:block">
        <Skeleton className="mb-6 h-7 w-32" />
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="mb-3 h-6 w-full" />
        ))}
      </div>
      <div className="flex-1">
        <div className="h-14 border-b border-hairline-soft bg-surface" />
        <div className="p-6">
          <Skeleton className="mb-5 h-8 w-48" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Forbidden({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-6xl font-semibold tracking-tight text-ink-3">403</p>
      <h1 className="text-xl font-semibold text-ink">บัญชีนี้ไม่มีสิทธิ์เข้าหลังร้าน</h1>
      <p className="max-w-sm text-sm text-ink-2">หลังร้านใช้ได้เฉพาะพนักงาน แอดมิน และเจ้าของร้าน หากคิดว่าเป็นความผิดพลาด โปรดติดต่อเจ้าของร้าน</p>
      <div className="mt-4 flex gap-2">
        <LinkButton href="/">กลับหน้าร้าน</LinkButton>
        <Button variant="primary" onClick={onLogout}>
          เข้าสู่ระบบด้วยบัญชีอื่น
        </Button>
      </div>
    </div>
  );
}
