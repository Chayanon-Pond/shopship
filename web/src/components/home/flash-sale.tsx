"use client";

import { clsx } from "clsx";
import { ChevronRight, Plus, Zap } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { memo, useRef } from "react";
import type { FlashSaleCurrent, FlashSaleItem } from "@/lib/api/types";
import { useCartAdd } from "@/components/store/cart";
import { Countdown, Reveal, SoldBar, useBefore } from "@/components/ui/motion";
import { Shelf } from "@/components/ui/shelf";
import { Img, Price, discountPercent } from "@/components/ui/primitives";

// memo: the section re-renders on clock boundaries / context changes; the cards only when their item changes
const FlashTile = memo(function FlashTile({ it, wide, sizes = "(min-width:1024px) 240px, 45vw" }: { it: FlashSaleItem; wide?: boolean; sizes?: string }) {
  const add = useCartAdd();
  const ref = useRef<HTMLDivElement>(null);
  const pct = discountPercent(it.sale_price_satang, it.lowest_30d_satang);
  const soldOut = it.remaining_qty <= 0;
  return (
    <article className={clsx("group relative flex h-full flex-col rounded-tile bg-white p-3 sm:p-4", wide && "sm:flex-row sm:gap-4")}>
      <div ref={ref} className="relative aspect-square overflow-hidden rounded-[14px] bg-canvas-alt">
        {it.product.image ? (
          <Img src={it.product.image.url} alt={it.product.image.alt} fill sizes={sizes} className="object-cover transition-transform duration-700 group-hover:scale-[1.05]" />
        ) : null}
        {pct ? <span className="absolute left-2 top-2 rounded-pill bg-sale px-2 py-0.5 text-xs font-semibold text-white">−{pct}%</span> : null}
      </div>
      <div className="flex flex-1 flex-col pt-3">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug">
          <Link href={`/p/${it.product.slug}`} className="after:absolute after:inset-0">
            {it.product.name}
          </Link>
        </h3>
        <p className="text-xs text-ink-2">{it.variant_name}</p>
        <div className="mt-auto pt-2">
          <Price value={it.sale_price_satang} strike={it.lowest_30d_satang} sale size="lg" />
          <SoldBar sold={it.sold_qty} limit={it.qty_limit} className="mt-2" />
          {it.per_customer_limit ? <p className="mt-1 text-[11px] text-ink-2">จำกัด {it.per_customer_limit} ชิ้น/คน</p> : null}
        </div>
      </div>
      <button
        type="button"
        disabled={soldOut}
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          void add(it.variant_id, 1, r ? { rect: r, image: it.product.image?.url } : undefined, it.product.name);
        }}
        aria-label={`ใส่ ${it.product.name} ราคา Flash Sale ลงตะกร้า`}
        className="absolute right-5 top-5 z-10 grid size-10 place-items-center rounded-full bg-ink text-white shadow-[0_4px_14px_rgb(0_0_0/0.2)] transition hover:scale-105 active:scale-[0.88] disabled:opacity-30 sm:right-6 sm:top-6"
      >
        <Plus className="size-5" aria-hidden />
      </button>
    </article>
  );
});

/**
 * Flash Sale block: flip-digit countdown, progress "ขายแล้ว 72%", direct add (variant is known).
 * `layout="shelf"` (home, campaign, promotions) = every live item in a horizontal Apple-style shelf;
 * `layout="grid"` (/flash-sale) = up to `limit` items in a grid.
 */
export function FlashSaleSection({
  data,
  limit = 48,
  showAllLink = true,
  layout = "shelf",
}: {
  data: FlashSaleCurrent;
  limit?: number;
  showAllLink?: boolean;
  layout?: "shelf" | "grid";
}) {
  const cur = data.current;
  // only re-renders when a boundary is crossed (not every second); null before hydration
  const beforeStart = useBefore(cur?.starts_at);
  const beforeEnd = useBefore(cur?.ends_at);
  const started = beforeStart !== true;
  const ended = beforeEnd === false;
  if (!cur && !data.next) return null;
  const live = cur && started && !ended;
  const items = cur ? cur.items.slice(0, limit) : [];

  return (
    <section aria-labelledby="flash-title" className="cv-section bg-gradient-to-b from-[#fff4ec] to-[#fff] py-12 md:py-16">
      <div className="container-page">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 md:mb-8">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <h2 id="flash-title" className="inline-flex items-center gap-2 text-[28px] font-semibold tracking-[-0.02em] md:text-[40px]">
              <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#ff6a00] to-[#e0115f] text-white md:size-11">
                <Zap className="size-5 md:size-6" fill="currentColor" aria-hidden />
              </span>
              Flash Sale
            </h2>
            {cur && !ended ? (
              <div className="flex items-center gap-2 text-sm font-medium text-ink-2">
                {live ? "จบใน" : "เริ่มใน"}
                <Countdown to={live ? cur.ends_at : cur.starts_at} dark label={live ? "Flash Sale จบใน" : "Flash Sale เริ่มใน"} className="text-base" />
              </div>
            ) : data.next ? (
              <p className="text-sm text-ink-2">
                รอบถัดไป: {data.next.label} ·{" "}
                {new Date(data.next.starts_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            ) : null}
          </div>
          {showAllLink ? (
            <Link href="/flash-sale" className="inline-flex items-center gap-0.5 text-[15px] text-link hover:underline">
              ดูทั้งหมด <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
        {!cur || ended ? <p className="rounded-tile bg-white p-8 text-center text-ink-2">Flash Sale รอบนี้จบแล้ว ติดตามรอบถัดไปเร็ว ๆ นี้</p> : null}
        {cur && !ended && layout === "grid" ? (
          <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {items.map((it, k) => (
              <Reveal as="li" key={it.flash_sale_item_id} delay={(k % 4) * 0.07} className={clsx(!live && "pointer-events-none opacity-60")}>
                <FlashTile it={it} />
              </Reveal>
            ))}
          </ul>
        ) : null}
      </div>
      {cur && !ended && layout === "shelf" ? (
        <Reveal y={20}>
          <Shelf label="สินค้า Flash Sale" className={clsx(!live && "pointer-events-none opacity-60")}>
            {items.map((it) => (
              <FlashTile key={it.flash_sale_item_id} it={it} sizes="(min-width:1280px) 280px, (min-width:768px) 240px, 42vw" />
            ))}
          </Shelf>
        </Reveal>
      ) : null}
    </section>
  );
}
