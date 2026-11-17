"use client";

import { clsx } from "clsx";
import { Heart, Plus, Zap } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { memo, useRef, useState } from "react";
import type { Offer, ProductCard } from "@/lib/api/types";
import { formatBaht } from "@/lib/money";
import { useWishlist } from "@/components/store/personal";
import { Badge, Img, Price, Stars, discountPercent } from "@/components/ui/primitives";
import { QuickAdd } from "./quick-add";
import { thNumber } from "@/lib/intl";

export function soldText(n: number) {
  if (n >= 10000) return `ขายแล้ว ${thNumber(Math.floor(n / 1000) / 10)} หมื่น+`;
  if (n >= 1000) return `ขายแล้ว ${thNumber(Math.floor(n / 100) / 10)} พัน+`;
  return n > 0 ? `ขายแล้ว ${n}` : "";
}

/** Public price of a card: public flash price when running, else the list price range. */
export function cardPrice(p: ProductCard) {
  if (p.flash) return { value: p.flash.sale_price_satang, strike: p.flash.lowest_30d_satang, flash: true };
  return { value: p.min_price_satang, strike: null as number | null, flash: false };
}

/** memo: grids re-render when personal offers / session load; a card only re-renders when its own props change. */
export const ProductTile = memo(function ProductTile({
  p,
  priority,
  offer,
  variantId,
  className,
}: {
  p: ProductCard;
  priority?: boolean;
  /** personal price from /offers (client) — only passed by member-price sections */
  offer?: Offer;
  /** known default variant → quick add skips the picker when it is the only one */
  variantId?: number;
  className?: string;
}) {
  const wish = useWishlist();
  const pub = cardPrice(p);
  const personal = offer && offer.price_satang < pub.value && offer.price_source.kind !== "list" ? offer : undefined;
  const value = personal ? personal.price_satang : pub.value;
  const strike = personal ? personal.lowest_30d_satang : pub.strike;
  const pct = discountPercent(value, strike);
  const imgRef = useRef<HTMLDivElement>(null);
  const [quick, setQuick] = useState(false);
  // the heart pops only after a tap (not on every hydration)
  const [tapped, setTapped] = useState(false);
  const liked = wish.has(p.id);
  const href = `/p/${p.slug}`;

  return (
    <article className={clsx("group relative flex h-full flex-col", className)}>
      <div ref={imgRef} className="relative aspect-square overflow-hidden rounded-tile bg-canvas-alt">
        <Link href={href} className="absolute inset-0" aria-label={p.name} tabIndex={-1}>
          {p.image ? (
            <Img
              src={p.image.url}
              alt={p.image.alt || p.name}
              fill
              sizes="(min-width:1280px) 280px, (min-width:768px) 30vw, 46vw"
              className="object-cover transition-transform duration-700 ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-[1.045]"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : undefined}
            />
          ) : null}
        </Link>
        <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-col items-start gap-1">
          {pub.flash ? (
            <Badge tone="sale" className="bg-white/90 backdrop-blur">
              <Zap className="size-3" fill="currentColor" aria-hidden /> Flash Sale
            </Badge>
          ) : null}
          {pct >= 5 ? <Badge tone="dark">−{pct}%</Badge> : null}
          {!p.in_stock ? <Badge>สินค้าหมด</Badge> : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setTapped(true);
            void wish.toggle(p.id, p.name);
          }}
          aria-pressed={liked}
          aria-label={liked ? `นำ ${p.name} ออกจากรายการโปรด` : `บันทึก ${p.name} ในรายการโปรด`}
          className="absolute right-2 top-2 z-10 grid size-9 place-items-center rounded-full bg-white/80 text-ink backdrop-blur transition hover:bg-white active:scale-[0.85]"
        >
          <span key={String(liked)} className={clsx("inline-grid", tapped && "fx-heart-pop")}>
            <Heart className={clsx("size-[17px]", liked && "fill-[#ff2d55] text-[#ff2d55]")} aria-hidden />
          </span>
        </button>
        {p.in_stock ? (
          <button
            type="button"
            onClick={() => setQuick(true)}
            aria-label={`ใส่ ${p.name} ลงตะกร้า`}
            className="absolute bottom-2.5 right-2.5 z-10 grid size-10 place-items-center rounded-full bg-ink text-white shadow-[0_4px_14px_rgb(0_0_0/0.2)] transition-transform duration-300 hover:scale-105 active:scale-[0.88] md:translate-y-2 md:opacity-0 md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100 md:group-hover:translate-y-0 md:group-hover:opacity-100"
          >
            <Plus className="size-5" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col px-1 pt-3">
        {p.badges.length ? (
          <p className="mb-1 line-clamp-1 text-[12px] font-semibold text-sale">{p.badges[0]}</p>
        ) : p.brand ? (
          <p className="mb-0.5 line-clamp-1 text-[12px] text-ink-2">{p.brand}</p>
        ) : null}
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.01em]">
          <Link href={href} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {p.name}
          </Link>
        </h3>
        {p.subtitle ? <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-2">{p.subtitle}</p> : null}
        <div className="mt-auto pt-2">
          {personal ? <p className="text-[11px] font-semibold text-link">{personal.price_source.label || "ราคาสำหรับคุณ"}</p> : null}
          <Price value={value} strike={strike} sale={pub.flash || !!personal} from={!personal && !pub.flash && p.max_price_satang > p.min_price_satang} />
          {personal?.qty_breaks.length ? (
            <p className="text-[11px] text-ink-2">
              ราคาส่ง {personal.qty_breaks[0].min_qty}+ ชิ้น {formatBaht(personal.qty_breaks[0].unit_price_satang)}
            </p>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-2">
            {p.rating_count > 0 ? <Stars value={p.rating_avg} size={11} /> : null}
            {p.rating_count > 0 ? <span className="tabular-nums">{p.rating_avg.toFixed(1)}</span> : null}
            {p.sold_count > 0 ? <span className="truncate">· {soldText(p.sold_count)}</span> : null}
          </div>
        </div>
      </div>
      {quick ? <QuickAdd slug={p.slug} name={p.name} variantId={variantId} originRef={imgRef} onClose={() => setQuick(false)} /> : null}
    </article>
  );
});

export function TileSkeleton() {
  return (
    <div aria-hidden>
      <span className="shine block aspect-square rounded-tile bg-canvas-alt" />
      <span className="shine mt-3 block h-4 w-3/4 rounded bg-canvas-alt" />
      <span className="shine mt-2 block h-3 w-1/2 rounded bg-canvas-alt" />
      <span className="shine mt-3 block h-5 w-1/3 rounded bg-canvas-alt" />
    </div>
  );
}
