"use client";

/** Top-bar search: orders / products / customers (filtered by perms). ⌘K / Ctrl+K focuses it. */
import { ClipboardList, Loader2, Package, Search, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatBaht } from "@/lib/money";
import { listOrders, listProducts, listUsers } from "@/lib/api/admin";
import { useDebounced } from "@/lib/admin/hooks";
import { ORDER_STATUS_LABEL } from "@/lib/admin/format";
import { useSession } from "./session";

type Hit = { href: string; title: string; sub: string; kind: "order" | "product" | "user" };

export function GlobalSearch() {
  const { can } = useSession();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<{ q: string; items: Hit[] } | null>(null);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q.trim(), 250);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    const onDoc = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, []);

  useEffect(() => {
    if (dq.length < 2) return;
    let alive = true;
    const jobs: Promise<Hit[]>[] = [];
    if (can("orders:read"))
      jobs.push(listOrders({ q: dq, per_page: 4 }).then((r) => r.data.map((o) => ({ kind: "order" as const, href: `/admin/orders/${o.order_no}`, title: o.order_no, sub: `${o.customer.name} · ${ORDER_STATUS_LABEL[o.status]} · ${formatBaht(o.grand_total_satang)}` }))));
    if (can("catalog:read"))
      jobs.push(listProducts({ q: dq, per_page: 4 }).then((r) => r.data.map((p) => ({ kind: "product" as const, href: `/admin/products/${p.id}`, title: p.name, sub: `${p.category.name} · ${formatBaht(p.min_price_satang)} · สต็อก ${p.total_stock}` }))));
    if (can("customers:read"))
      jobs.push(listUsers({ q: dq, per_page: 4 }).then((r) => r.data.map((u) => ({ kind: "user" as const, href: `/admin/customers/${u.id}`, title: u.name || u.email, sub: u.email }))));
    Promise.allSettled(jobs).then((rs) => {
      if (!alive) return;
      setHits({ q: dq, items: rs.flatMap((r) => (r.status === "fulfilled" ? r.value : [])) });
      setActive(0);
    });
    return () => {
      alive = false;
    };
  }, [dq, can]);

  const loading = dq.length >= 2 && hits?.q !== dq;
  const items = dq.length >= 2 && hits?.q === dq ? hits.items : [];
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    router.push(h.href);
  };
  const Icon = { order: ClipboardList, product: Package, user: User };

  return (
    <div ref={boxRef} className="relative w-full max-w-[420px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && items[active]) go(items[active]);
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="ค้นหาคำสั่งซื้อ สินค้า ลูกค้า…"
        aria-label="ค้นหาในหลังร้าน"
        role="combobox"
        aria-expanded={open && dq.length >= 2}
        aria-controls="admin-search-results"
        className="h-9 w-full rounded-[10px] border border-transparent bg-canvas-alt pl-9 pr-14 text-sm text-ink placeholder:text-ink-2 focus:border-accent focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-accent-soft"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-hairline px-1.5 text-[10px] text-ink-2 lg:block">Ctrl K</kbd>
      {open && dq.length >= 2 ? (
        <div id="admin-search-results" role="listbox" className="absolute left-0 right-0 top-11 z-50 max-h-[60vh] overflow-y-auto rounded-[12px] border border-hairline-soft bg-surface p-1.5 shadow-[var(--shadow-pop)] sm:right-auto sm:w-[480px]">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-ink-2">
              <Loader2 className="size-4 animate-spin" aria-hidden /> กำลังค้นหา…
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-3 text-sm text-ink-2">ไม่พบผลลัพธ์สำหรับ “{dq}”</p>
          ) : (
            items.map((h, i) => {
              const I = Icon[h.kind];
              return (
                <button
                  key={h.href}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left ${i === active ? "bg-canvas-alt" : ""}`}
                >
                  <I className="size-4 shrink-0 text-ink-2" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{h.title}</span>
                    <span className="block truncate text-xs text-ink-2">{h.sub}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
