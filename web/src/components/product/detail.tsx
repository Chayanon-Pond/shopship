"use client";

import { clsx } from "clsx";
import { BadgePercent, Heart, Lock, Share2, ShieldCheck, Truck, Undo2, Zap } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Offer, Product, PromoCode } from "@/lib/api/types";
import { formatBaht } from "@/lib/money";
import { useCart } from "@/components/store/cart";
import { useOffers, useWishlist } from "@/components/store/personal";
import { useSession } from "@/components/store/session";
import { useToast } from "@/components/store/toast";
import { Countdown, CopyCode, QtyStepper, useBefore } from "@/components/ui/motion";
import { Badge, Price, Stars, discountPercent } from "@/components/ui/primitives";
import { Gallery } from "./gallery";
import { soldText } from "./tile";
import { VariantPicker } from "./variant-picker";
import { findVariant, initialSelection, type Selection } from "./variants";
import { thNumber } from "@/lib/intl";

/** Which unit price applies for `qty` given a personal offer (display only — the cart quote is authoritative). */
function tierFor(offer: Offer | undefined, qty: number) {
  if (!offer) return null;
  return [...offer.qty_breaks].sort((a, b) => b.min_qty - a.min_qty).find((b) => qty >= b.min_qty) ?? null;
}

export function ProductDetail({ p, codes }: { p: Product; codes: PromoCode[] }) {
  const { me, ready } = useSession();
  const cart = useCart();
  const wish = useWishlist();
  const toast = useToast();
  const router = useRouter();
  const [sel, setSel] = useState<Selection>(() => initialSelection(p));
  const [qty, setQty] = useState(1);
  const v = findVariant(p, sel);
  const imgIndexFor = (imageId: number | null | undefined) => Math.max(0, p.images.findIndex((i) => i.id === imageId));
  const [imgIndex, setImgIndex] = useState(() => imgIndexFor(v?.image_id));
  const mainRef = useRef<HTMLDivElement>(null);
  const buyRef = useRef<HTMLDivElement>(null);
  const [showBar, setShowBar] = useState(false);
  const flashBeforeEnd = useBefore(p.flash?.ends_at);

  const pickSel = (next: Selection) => {
    setSel(next);
    const nv = findVariant(p, next);
    const i = nv ? p.images.findIndex((x) => x.id === nv.image_id) : -1;
    if (nv && nv.id !== v?.id && i >= 0) setImgIndex(i);
  };

  useEffect(() => {
    const el = buyRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShowBar(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const offers = useOffers(p.variants.map((x) => x.id));
  const offer = v ? offers.get(v.id) : undefined;
  const flashLive = p.flash && flashBeforeEnd !== false;

  // price shown: personal offer (exact per variant) once loaded; before that the PUBLIC price
  const publicValue = flashLive && p.flash ? Math.min(p.flash.sale_price_satang, v?.price_satang ?? p.min_price_satang) : (v?.price_satang ?? p.min_price_satang);
  const publicStrike = flashLive && p.flash ? p.flash.lowest_30d_satang : null;
  const personal = offer && offer.price_source.kind !== "list" ? offer : undefined;
  // qty breaks only apply to signed-in buyers (the cart quote ignores them for guests); guests see them as a teaser
  const tier = me ? tierFor(offer, qty) : null;
  const base = offer ? offer.price_satang : publicValue;
  const useTier = tier && tier.unit_price_satang < base ? tier : null;
  const unit = useTier ? useTier.unit_price_satang : base;
  // strike-through only ever from the API's lowest_30d (never an invented compare-at)
  const strike = offer ? offer.lowest_30d_satang : publicStrike;
  const label = useTier ? `ราคาส่ง ${useTier.min_qty}+ ชิ้น` : personal?.price_source.label;
  const isFlash = (offer ? offer.price_source.kind === "flash_sale" : !!flashLive) && !useTier;
  const pct = discountPercent(unit, strike);
  const priceKey = `${unit}-${label}`;
  const [firstPriceKey] = useState(priceKey);
  const hasTradeBadge = p.badges.some((b) => b.includes("ราคาส่ง")) || (offer?.qty_breaks.length ?? 0) > 0;
  const maxQty = isFlash ? 1 : 999;

  async function add(goCart?: boolean) {
    if (!v) return;
    const r = mainRef.current?.getBoundingClientRect();
    const img = p.images.find((i) => i.id === v.image_id) ?? p.image;
    const ok = await cart.add(v.id, qty, r ? { rect: r, image: img?.url } : undefined, p.name);
    if (ok && goCart) router.push("/cart");
  }
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: p.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ tone: "ok", text: "คัดลอกลิงก์สินค้าแล้ว" });
      }
    } catch {
      /* cancelled */
    }
  }

  const promos = useMemo(() => {
    const list: { key: string; text: string; tone: "sale" | "accent" | "neutral" }[] = [];
    for (const b of p.badges) list.push({ key: b, text: b, tone: "sale" });
    for (const b of offer?.badges ?? []) if (!p.badges.includes(b)) list.push({ key: `o${b}`, text: b, tone: "accent" });
    return list;
  }, [p.badges, offer?.badges]);

  const liked = wish.has(p.id);

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10 lg:gap-16">
      <div className="md:sticky md:top-[120px] md:self-start">
        <Gallery images={p.images.length ? p.images : p.image ? [p.image] : []} index={imgIndex} onIndex={setImgIndex} mainRef={mainRef} name={p.name} />
      </div>

      <div className="min-w-0">
        {p.brand ? <p className="text-sm font-medium text-ink-2">{p.brand}</p> : null}
        <h1 className="mt-1 text-[30px] font-semibold leading-tight tracking-[-0.025em] md:text-[40px]">{p.name}</h1>
        {p.name_en ? <p className="mt-0.5 text-ink-2">{p.name_en}</p> : null}
        {p.subtitle ? <p className="mt-2 text-lg text-ink-2">{p.subtitle}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {p.reviews_summary.rating_count > 0 ? (
            <a href="#reviews" className="inline-flex items-center gap-1.5 hover:underline">
              <Stars value={p.reviews_summary.rating_avg} />
              <span className="font-semibold">{p.reviews_summary.rating_avg.toFixed(1)}</span>
              <span className="text-ink-2">({thNumber(p.reviews_summary.rating_count)} รีวิว)</span>
            </a>
          ) : (
            <span className="text-ink-2">ยังไม่มีรีวิว</span>
          )}
          {p.sold_count ? <span className="text-ink-2">· {soldText(p.sold_count)}</span> : null}
        </div>

        {/* price block */}
        <div className={clsx("mt-6 rounded-[20px] p-5", isFlash ? "bg-gradient-to-r from-[#fff1e6] to-[#ffe9f0]" : "bg-canvas-alt")}>
          {isFlash && p.flash ? (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-sale">
                <Zap className="size-4" fill="currentColor" aria-hidden /> Flash Sale
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-2">
                จบใน <Countdown to={p.flash.ends_at} dark label="Flash Sale จบใน" className="text-[13px]" />
              </span>
            </div>
          ) : null}
          {/* a changed price (variant / member offer / qty tier) remounts and rises in; the first paint does not animate */}
          <div key={priceKey} className={priceKey !== firstPriceKey ? "fx-rise-in" : undefined}>
              {label ? <p className="mb-1 text-sm font-semibold text-link">{label}</p> : null}
              <div className="flex flex-wrap items-baseline gap-x-3">
                <Price value={unit} strike={strike} size="xl" sale={isFlash || !!label} />
                {pct >= 1 ? <Badge tone="dark">ลด {pct}%</Badge> : null}
              </div>
          </div>
          {strike && strike > unit ? <p className="mt-1 text-xs text-ink-2">ราคาขีดฆ่า = ราคาต่ำสุดใน 30 วันก่อนเริ่มโปรโมชัน</p> : null}
          {offer && unit < offer.list_price_satang && !(strike && strike > unit) ? (
            <p className="mt-1 text-xs text-ink-2">ราคาปกติ {formatBaht(offer.list_price_satang)} / ชิ้น</p>
          ) : null}
          {isFlash && p.flash ? <p className="mt-1 text-xs text-ink-2">เหลือ {p.flash.remaining_qty} ชิ้นในรอบนี้ · จำกัดต่อคน</p> : null}

          {offer && offer.qty_breaks.length ? (
            <div className="mt-4 overflow-hidden rounded-[14px] bg-white">
              <p className="flex items-center gap-1.5 border-b border-hairline-soft px-4 py-2.5 text-sm font-semibold">
                <BadgePercent className="size-4 text-link" aria-hidden /> {me ? "ราคาส่งสำหรับคุณ" : "ราคาส่งตามจำนวน (สำหรับสมาชิก)"}
              </p>
              <table className="w-full text-sm">
                <caption className="sr-only">ราคาส่งตามจำนวน</caption>
                <thead className="sr-only">
                  <tr>
                    <th>จำนวน</th>
                    <th>ราคาต่อชิ้น</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={clsx("transition-colors", !useTier && "bg-accent-soft/60")}>
                    <td className="px-4 py-2 text-ink-2">1–{offer.qty_breaks[0].min_qty - 1} ชิ้น</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatBaht(offer.price_satang)}</td>
                  </tr>
                  {[...offer.qty_breaks]
                    .sort((a, b) => a.min_qty - b.min_qty)
                    .map((b) => (
                      <tr key={b.min_qty} className={clsx("border-t border-hairline-soft transition-colors", useTier?.min_qty === b.min_qty && "bg-accent-soft/60")}>
                        <td className="px-4 py-2">
                          <button type="button" className="text-link hover:underline" onClick={() => setQty(b.min_qty)}>
                            ราคาส่ง: {b.min_qty}+ ชิ้น
                          </button>
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums">
                          {formatBaht(b.unit_price_satang)}
                          <span className="ml-1 text-xs font-normal text-success">−{discountPercent(b.unit_price_satang, offer.list_price_satang)}%</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {ready && !me ? (
                <Link href={`/login?next=/p/${p.slug}`} className="flex items-center gap-1.5 border-t border-hairline-soft px-4 py-2.5 text-sm font-medium text-link hover:underline">
                  <Lock className="size-3.5" aria-hidden /> เข้าสู่ระบบเพื่อใช้ราคาส่งและราคาสมาชิก
                </Link>
              ) : null}
            </div>
          ) : ready && !me ? (
            <Link href={`/login?next=/p/${p.slug}`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline">
              <Lock className="size-3.5" aria-hidden /> {hasTradeBadge ? "เข้าสู่ระบบเพื่อดูราคาส่งและราคาสมาชิก" : "เข้าสู่ระบบเพื่อดูราคาสมาชิก"}
            </Link>
          ) : null}
        </div>

        {/* promotions */}
        {promos.length || codes.length ? (
          <div className="mt-5">
            <h2 className="mb-2 text-sm font-semibold">โปรโมชันที่ใช้ได้</h2>
            <ul className="space-y-2">
              {promos.map((x) => (
                <li key={x.key}>
                  <Badge tone={x.tone === "sale" ? "sale" : "accent"} className="text-[13px]">
                    {x.text}
                  </Badge>
                </li>
              ))}
              {codes.slice(0, 2).map((c) => (
                <li key={c.code} className="flex flex-wrap items-center gap-3">
                  <CopyCode code={c.code} />
                  <span className="text-sm text-ink-2">{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-6">
          <VariantPicker product={p} sel={sel} onChange={pickSel} />
        </div>

        <div ref={buyRef} className="mt-6 space-y-3">
          <div className="flex items-center gap-3">
            <QtyStepper value={qty} onChange={setQty} max={maxQty} disabled={!v?.in_stock} />
            {useTier ? <span className="text-sm font-medium text-success">ได้ราคาส่งแล้ว!</span> : me && offer?.qty_breaks[0] && qty < offer.qty_breaks[0].min_qty ? <span className="text-sm text-ink-2">อีก {offer.qty_breaks[0].min_qty - qty} ชิ้นได้ราคาส่ง</span> : null}
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn btn-primary h-[52px] flex-1 text-[17px] active:scale-[0.97]" disabled={!v?.in_stock || cart.busy} onClick={() => add()}>
              {v?.in_stock ? "ใส่ตะกร้า" : "สินค้าหมด"}
            </button>
            <button
              type="button"
              className="btn h-[52px] flex-1 bg-ink text-[17px] text-white hover:bg-black active:scale-[0.97]"
              disabled={!v?.in_stock || cart.busy}
              onClick={() => add(true)}
            >
              ซื้อเลย
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => wish.toggle(p.id, p.name)} aria-pressed={liked} className="btn btn-secondary h-10 flex-1 text-sm">
              <Heart className={clsx("size-4", liked && "fill-[#ff2d55] text-[#ff2d55]")} aria-hidden /> {liked ? "อยู่ในรายการโปรด" : "เพิ่มในรายการโปรด"}
            </button>
            <button type="button" onClick={share} className="btn btn-secondary h-10 text-sm" aria-label="แชร์สินค้า">
              <Share2 className="size-4" aria-hidden /> แชร์
            </button>
          </div>
        </div>

        <ul className="mt-6 divide-y divide-hairline-soft rounded-[20px] border border-hairline-soft text-sm">
          <li className="flex gap-3 p-4">
            <Truck className="size-5 shrink-0 text-ink-2" aria-hidden />
            <span>
              <span className="font-semibold">ส่งฟรีเมื่อช้อปครบ ฿990</span>
              <span className="block text-ink-2">จัดส่งโดย Flash Express ได้รับภายใน 1–3 วันทำการ</span>
            </span>
          </li>
          <li className="flex gap-3 p-4">
            <ShieldCheck className="size-5 shrink-0 text-ink-2" aria-hidden />
            <span>
              <span className="font-semibold">ชำระเงินปลอดภัย</span>
              <span className="block text-ink-2">PromptPay QR หรือบัตรเครดิต/เดบิต</span>
            </span>
          </li>
          <li className="flex gap-3 p-4">
            <Undo2 className="size-5 shrink-0 text-ink-2" aria-hidden />
            <span>
              <span className="font-semibold">รับประกันของแท้</span>
              <span className="block text-ink-2">สินค้ามีปัญหา แจ้งร้านได้ภายใน 7 วันหลังได้รับ</span>
            </span>
          </li>
        </ul>
      </div>

      <StickyBuyBar show={showBar} name={p.name} unit={unit} strike={strike} disabled={!v?.in_stock || cart.busy} onAdd={() => add()} onBuy={() => add(true)} />
    </div>
  );
}

function StickyBuyBar({
  show,
  name,
  unit,
  strike,
  disabled,
  onAdd,
  onBuy,
}: {
  show: boolean;
  name: string;
  unit: number;
  strike: number | null;
  disabled: boolean;
  onAdd: () => void;
  onBuy: () => void;
}) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    // always mounted; slides in/out with a CSS transition, `inert` while hidden (no focus / no clicks)
    <div
      inert={!show}
      aria-hidden={!show}
      className={clsx(
        "pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-hairline-soft bg-white/85 backdrop-blur-xl backdrop-saturate-[1.8] transition-transform duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]",
        !show && "translate-y-[110%]",
      )}
    >
          <div className="container-page flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="hidden truncate text-sm font-semibold md:block">{name}</p>
              <Price value={unit} strike={strike} size="md" sale={!!strike && strike > unit} />
            </div>
            <button type="button" className="btn btn-secondary h-11 px-4" disabled={disabled} onClick={onAdd}>
              ใส่ตะกร้า
            </button>
            <button type="button" className="btn btn-primary h-11 px-5" disabled={disabled} onClick={onBuy}>
              ซื้อเลย
            </button>
          </div>
    </div>,
    document.body,
  );
}
