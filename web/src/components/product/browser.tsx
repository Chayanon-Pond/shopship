"use client";

import { clsx } from "clsx";
import { Check, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api/storefront";
import type { ListEnvelope, ProductCard, ProductQuery, ProductSort } from "@/lib/api/types";
import { Sheet } from "@/components/ui/motion";
import { GridSkeleton, ProductGrid } from "./grid";
import { thNumber } from "@/lib/intl";

const SORTS: { v: ProductSort; label: string }[] = [
  { v: "relevance", label: "เกี่ยวข้องที่สุด" },
  { v: "newest", label: "มาใหม่" },
  { v: "best_selling", label: "ขายดี" },
  { v: "price_asc", label: "ราคา: ต่ำ → สูง" },
  { v: "price_desc", label: "ราคา: สูง → ต่ำ" },
  { v: "rating", label: "คะแนนรีวิว" },
];
const PRICES: { label: string; min?: number; max?: number }[] = [
  { label: "ต่ำกว่า ฿300", max: 30000 },
  { label: "฿300 – ฿1,000", min: 30000, max: 100000 },
  { label: "฿1,000 – ฿2,000", min: 100000, max: 200000 },
  { label: "฿2,000 ขึ้นไป", min: 200000 },
];

export type BrowserFilters = { sort?: ProductSort; min?: number; max?: number; rating?: number; stock?: boolean; sale?: boolean };

export function readFilters(sp: URLSearchParams): BrowserFilters {
  const n = (k: string) => (sp.get(k) && Number.isFinite(Number(sp.get(k))) ? Number(sp.get(k)) : undefined);
  const sort = sp.get("sort") as ProductSort | null;
  return {
    sort: sort && SORTS.some((s) => s.v === sort) ? sort : undefined,
    min: n("min_price"),
    max: n("max_price"),
    rating: n("rating_min"),
    stock: sp.get("in_stock") === "true" || undefined,
    sale: sp.get("on_sale") === "true" || undefined,
  };
}

/**
 * URL-synced product listing (category or search). Reads searchParams — render inside <Suspense>.
 * `initial` is the cached server page for the default query, reused when no filter is set.
 */
export function ProductBrowser({
  base,
  initial,
  variants,
  heading,
}: {
  base: { category?: string };
  initial?: ListEnvelope<ProductCard>;
  variants?: Record<string, number>;
  heading?: "search";
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const q = sp.get("q")?.trim() ?? "";
  const f = useMemo(() => readFilters(new URLSearchParams(sp.toString())), [sp]);
  const isDefault = !q && !f.sort && f.min === undefined && f.max === undefined && !f.rating && !f.stock && !f.sale;
  const query: ProductQuery = useMemo(
    () => ({
      ...base,
      q: q || undefined,
      sort: f.sort ?? (q ? "relevance" : "newest"),
      min_price: f.min,
      max_price: f.max,
      rating_min: f.rating,
      in_stock: f.stock,
      on_sale: f.sale,
      per_page: 24,
    }),
    [base, q, f],
  );
  const key = JSON.stringify(query);
  const [pages, setPages] = useState<{ key: string; items: ProductCard[]; page: number; totalPages: number; total: number } | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const fromInitial = isDefault && initial ? { key, items: initial.data, page: 1, totalPages: initial.meta.total_pages, total: initial.meta.total } : null;
  const view = pages?.key === key ? pages : fromInitial;
  const error = errorKey === key;
  const loading = moreLoading || (!view && !error);

  useEffect(() => {
    if (fromInitial || pages?.key === key) return;
    let alive = true;
    api
      .getProducts({ ...query, page: 1 })
      .then((r) => alive && setPages({ key, items: r.data, page: 1, totalPages: r.meta.total_pages, total: r.meta.total }))
      .catch(() => alive && setErrorKey(key));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function more() {
    if (!view || moreLoading || view.page >= view.totalPages) return;
    setMoreLoading(true);
    try {
      const r = await api.getProducts({ ...query, page: view.page + 1 });
      setPages({ ...view, items: [...view.items, ...r.data], page: r.meta.page, totalPages: r.meta.total_pages });
    } catch {
      setErrorKey(key);
    } finally {
      setMoreLoading(false);
    }
  }
  // infinite load when the sentinel scrolls into view
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && void more(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  });

  function update(next: Partial<Record<string, string | undefined>>) {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "") p.delete(k);
      else p.set(k, v);
    }
    p.delete("page");
    const s = p.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  }
  const priceIdx = PRICES.findIndex((x) => x.min === f.min && x.max === f.max);
  const active: { label: string; clear: Partial<Record<string, undefined>> }[] = [];
  if (priceIdx >= 0) active.push({ label: PRICES[priceIdx].label, clear: { min_price: undefined, max_price: undefined } });
  if (f.rating) active.push({ label: `${f.rating} ดาวขึ้นไป`, clear: { rating_min: undefined } });
  if (f.stock) active.push({ label: "มีสินค้า", clear: { in_stock: undefined } });
  if (f.sale) active.push({ label: "ลดราคา", clear: { on_sale: undefined } });

  const filters = (
    <div className="space-y-6">
      <FilterGroup title="ช่วงราคา">
        {PRICES.map((pr, i) => (
          <Choice
            key={pr.label}
            on={priceIdx === i}
            onClick={() => update(priceIdx === i ? { min_price: undefined, max_price: undefined } : { min_price: pr.min?.toString(), max_price: pr.max?.toString() })}
          >
            {pr.label}
          </Choice>
        ))}
      </FilterGroup>
      <FilterGroup title="คะแนนรีวิว">
        {[4, 3].map((r) => (
          <Choice key={r} on={f.rating === r} onClick={() => update({ rating_min: f.rating === r ? undefined : String(r) })}>
            {"★".repeat(r)} ขึ้นไป
          </Choice>
        ))}
      </FilterGroup>
      <FilterGroup title="อื่น ๆ">
        <Choice on={!!f.stock} onClick={() => update({ in_stock: f.stock ? undefined : "true" })}>
          มีสินค้าพร้อมส่ง
        </Choice>
        <Choice on={!!f.sale} onClick={() => update({ on_sale: f.sale ? undefined : "true" })}>
          ลดราคา / มีโปรโมชัน
        </Choice>
      </FilterGroup>
    </div>
  );

  return (
    <div>
      {heading === "search" ? <SearchHeading total={view?.total ?? null} q={q} /> : null}
      <div className="sticky top-[96px] z-30 -mx-[var(--page-gutter)] mb-6 flex items-center gap-2 bg-white/85 px-[var(--page-gutter)] py-3 backdrop-blur-xl md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
        <button type="button" onClick={() => setSheet(true)} className="btn btn-secondary h-10 shrink-0 px-4 text-sm lg:hidden">
          <SlidersHorizontal className="size-4" aria-hidden /> ตัวกรอง{active.length ? ` (${active.length})` : ""}
        </button>
        <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {active.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => update(a.clear)}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-pill bg-accent-soft px-3.5 text-sm font-medium text-link transition-[transform,opacity] duration-300 starting:scale-90 starting:opacity-0"
              >
                {a.label} <X className="size-3.5" aria-hidden />
                <span className="sr-only">ลบตัวกรอง</span>
              </button>
            ))}
          {view ? <span className="hidden self-center whitespace-nowrap text-sm text-ink-2 md:inline">{thNumber(view.total)} รายการ</span> : null}
        </div>
        <label className="relative shrink-0">
          <span className="sr-only">เรียงตาม</span>
          <select
            value={f.sort ?? (q ? "relevance" : "newest")}
            onChange={(e) => update({ sort: e.target.value })}
            className="h-10 appearance-none rounded-pill bg-canvas-alt pl-4 pr-9 text-sm font-medium outline-none transition hover:bg-hairline-soft focus-visible:ring-2 focus-visible:ring-accent"
          >
            {SORTS.filter((s) => q || s.v !== "relevance").map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
        </label>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block" aria-label="ตัวกรอง">
          <div className="sticky top-[120px]">{filters}</div>
        </aside>
        <div className="min-w-0">
          {error ? (
            <p className="rounded-tile bg-canvas-alt p-8 text-center text-ink-2">โหลดสินค้าไม่สำเร็จ กรุณาลองใหม่</p>
          ) : !view ? (
            <GridSkeleton count={8} cols="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3" />
          ) : view.items.length === 0 ? (
            <div className="rounded-[24px] bg-canvas-alt p-10 text-center">
              <p className="text-xl font-semibold">ไม่พบสินค้า{q ? ` “${q}”` : "ตามตัวกรอง"}</p>
              <p className="mt-1 text-ink-2">ลองใช้คำค้นอื่น ตรวจตัวสะกด หรือล้างตัวกรอง</p>
              {active.length ? (
                <button type="button" className="btn btn-primary mt-5" onClick={() => update({ min_price: undefined, max_price: undefined, rating_min: undefined, in_stock: undefined, on_sale: undefined })}>
                  ล้างตัวกรองทั้งหมด
                </button>
              ) : null}
            </div>
          ) : (
            <div className={clsx("transition-opacity duration-300", loading && view.page === 1 && "opacity-50")}>
              <h2 className="sr-only">รายการสินค้า</h2>
              <ProductGrid products={view.items} variants={variants} cols="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3" priorityCount={2} />
              <div ref={sentinel} className="h-px" />
              {view.page < view.totalPages ? (
                <div className="mt-10 flex justify-center">
                  <button type="button" onClick={more} className="btn btn-secondary" disabled={loading}>
                    {loading ? "กำลังโหลด…" : "ดูสินค้าเพิ่มเติม"}
                  </button>
                </div>
              ) : view.items.length > 8 ? (
                <p className="mt-10 text-center text-sm text-ink-2">แสดงครบ {view.total} รายการแล้ว</p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="ตัวกรอง" side="bottom">
        {filters}
        <button type="button" className="btn btn-primary mt-6 w-full" onClick={() => setSheet(false)}>
          ดู {view?.total ?? ""} รายการ
        </button>
      </Sheet>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      <div className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">{children}</div>
    </fieldset>
  );
}
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={clsx(
        "inline-flex min-h-10 items-center gap-2 rounded-pill px-3.5 text-left text-sm transition active:scale-95 lg:rounded-[10px] lg:px-2.5",
        on ? "bg-ink text-white lg:bg-accent-soft lg:font-semibold lg:text-link" : "bg-canvas-alt hover:bg-hairline-soft lg:bg-transparent",
      )}
    >
      <span className={clsx("hidden size-4 place-items-center rounded-[5px] border lg:grid", on ? "border-link bg-link text-white" : "border-hairline")}>
        {on ? <Check className="size-3" aria-hidden /> : null}
      </span>
      {children}
    </button>
  );
}

function SearchHeading({ total, q }: { total: number | null; q: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.03em] md:text-[48px]">{q ? <>ผลการค้นหา “{q}”</> : "สินค้าทั้งหมด"}</h1>
      <p className="mt-1 text-ink-2" aria-live="polite">
        {total === null ? "กำลังค้นหา…" : total ? `พบ ${thNumber(total)} รายการ` : ""}
      </p>
    </div>
  );
}
