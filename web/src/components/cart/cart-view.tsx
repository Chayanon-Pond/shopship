"use client";

import { clsx } from "clsx";
import { AnimatePresence, m } from "motion/react";
import { CircleAlert, CircleCheck, Info, Lock, ShoppingBag, Sparkles, Tag, Trash2, Truck, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api/storefront";
import type { Cart, CartItem, Hint, Quote, QuoteLine } from "@/lib/api/types";
import { formatBaht, formatDiscount } from "@/lib/money";
import { useCart } from "@/components/store/cart";
import { useSession } from "@/components/store/session";
import { AnimatedBaht } from "@/components/ui/animated-baht";
import { EASE, QtyStepper } from "@/components/ui/motion";
import { Badge, Img, Price, Skeleton } from "@/components/ui/primitives";
import { blockingLines, couponFeedback, freeShipProgress, priceSourceBadge, type Tone } from "./logic";
import { MaxMotion } from "@/components/ui/motion-lazy";

/** quantity_break_gap → one-tap "+N" using the hint's variant_id + qty_needed. */
function qtyGap(h: Hint, q: Quote): { variantId: number; add: number; qty: number } | null {
  if (h.kind !== "quantity_break_gap" || !h.variant_id || !h.qty_needed) return null;
  const line = q.lines.find((l) => l.variant_id === h.variant_id);
  return line ? { variantId: line.variant_id, add: h.qty_needed, qty: line.qty + h.qty_needed } : null;
}

/** Re-quote via POST /cart/quote whenever the cart changes; the quote is the only source of money on this page. */
export function useLiveQuote(cart: Cart | null, body: api.QuoteBody = {}) {
  const [state, setState] = useState<{ sig: string; quote: Quote } | null>(null);
  const [override, setQuote] = useState<Quote | null>(null);
  const sig = cart ? `${cart.items.map((i) => `${i.variant_id}x${i.qty}`).join(",")}|${cart.coupon_code ?? ""}|${JSON.stringify(body)}` : "";
  useEffect(() => {
    if (!cart) return;
    let alive = true;
    api
      .quoteCart(body)
      .then((q) => alive && setState({ sig, quote: q }))
      .catch(() => alive && setState({ sig, quote: cart.quote }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const fresh = state?.sig === sig ? state.quote : null;
  return { quote: override && !fresh ? override : (fresh ?? state?.quote ?? cart?.quote ?? null), loading: !!cart && state?.sig !== sig, setQuote };
}

const toneCls: Record<Tone, string> = {
  success: "bg-[#e9f6ee] text-success",
  info: "bg-accent-soft text-link",
  warning: "bg-[#fff6e5] text-warning",
  error: "bg-[#fdecee] text-danger",
};
const toneIcon: Record<Tone, typeof Info> = { success: CircleCheck, info: Info, warning: CircleAlert, error: CircleAlert };

function CouponBoxInner({ quote, onApplied }: { quote: Quote; onApplied?: () => void }) {
  const cart = useCart();
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(false);
  const c = quote.coupon;
  const fb = c ? couponFeedback(c) : null;
  const Icon = fb ? toneIcon[fb.tone] : Info;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = code.trim().toUpperCase();
    if (!v) return;
    const res = await cart.applyCode(v);
    if (res) {
      setCode("");
      onApplied?.();
    }
  }
  return (
    <div>
      {c ? (
        <m.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={clsx("rounded-[14px] p-3.5", toneCls[fb!.tone])}>
          <div className="flex items-start gap-2.5">
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold">
                <span className="font-mono tracking-wider">{c.code}</span> · {fb!.title}
              </p>
              <p className="mt-0.5 opacity-90">{c.message}</p>
              {fb!.action ? (
                <Link href={fb!.action.href} className="mt-1 inline-block font-semibold underline">
                  {fb!.action.label}
                </Link>
              ) : null}
            </div>
            <button type="button" onClick={() => cart.removeCode()} className="-m-1 grid size-8 shrink-0 place-items-center rounded-full hover:bg-black/5" aria-label={`นำโค้ด ${c.code} ออก`}>
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </m.div>
      ) : null}
      {!c || c.status !== "applied" ? (
        open || c ? (
          <form onSubmit={submit} className="mt-3 flex gap-2">
            <label className="sr-only" htmlFor="coupon">
              โค้ดส่วนลด
            </label>
            <input
              id="coupon"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ใส่โค้ดส่วนลด / โค้ดเทศกาล"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="input flex-1 font-mono tracking-wider placeholder:font-sans placeholder:tracking-normal"
            />
            <button type="submit" className="btn btn-secondary shrink-0" disabled={!code.trim() || cart.busy}>
              ใช้โค้ด
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-[15px] font-medium text-link hover:underline">
            <Tag className="size-4" aria-hidden /> มีโค้ดส่วนลดหรือโค้ดเทศกาล?
          </button>
        )
      ) : null}
    </div>
  );
}

function Row({ label, value, tone, sub, strike }: { label: React.ReactNode; value: number; tone?: "discount" | "free"; sub?: string; strike?: number }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="min-w-0 text-ink-2">
        {label}
        {sub ? <span className="block text-xs text-ink-3">{sub}</span> : null}
      </dt>
      <dd className={clsx("shrink-0 text-right tabular-nums", tone === "discount" && "text-success", tone === "free" && "font-semibold text-success")}>
        {strike && strike > value ? <s className="mr-2 text-ink-3">{formatBaht(strike)}</s> : null}
        {tone === "free" ? "ฟรี" : tone === "discount" ? <AnimatedBaht value={value} signed="minus" /> : <AnimatedBaht value={value} />}
      </dd>
    </div>
  );
}

/** Totals block: every number straight from the quote, cart-level adjustments as labelled savings lines. */
export function Totals({ quote, showShippingNote = true }: { quote: Quote; showShippingNote?: boolean }) {
  const t = quote.totals;
  const ship = quote.shipping;
  return (
    <div>
      <dl className="text-[15px]">
        <Row label="ราคาสินค้า" value={t.subtotal_satang} strike={t.list_subtotal_satang} sub={t.list_subtotal_satang > t.subtotal_satang ? "รวมส่วนลดรายชิ้นแล้ว" : undefined} />
        <AnimatePresence initial={false}>
          {quote.adjustments.map((a) => (
            <m.div key={`${a.promotion_id}-${a.layer}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE }}>
              <Row label={<span className="inline-flex items-center gap-1.5"><Sparkles className="size-3.5 text-success" aria-hidden />{a.label}</span>} value={a.amount_satang} tone="discount" />
            </m.div>
          ))}
        </AnimatePresence>
        {ship.fee_satang === 0 && showShippingNote ? (
          <div className="flex justify-between py-1.5 text-ink-2">
            <dt>ค่าจัดส่ง</dt>
            <dd className="text-sm">คำนวณตอนชำระเงิน</dd>
          </div>
        ) : ship.discount_satang >= ship.fee_satang && ship.fee_satang > 0 ? (
          <Row label="ค่าจัดส่ง" sub={ship.label} value={0} tone="free" strike={ship.fee_satang} />
        ) : (
          <>
            <Row label="ค่าจัดส่ง" value={ship.fee_satang} />
            {ship.discount_satang > 0 ? <Row label={ship.label || "ส่วนลดค่าจัดส่ง"} value={ship.discount_satang} tone="discount" /> : null}
          </>
        )}
      </dl>
      <div className="mt-3 flex items-baseline justify-between border-t border-hairline-soft pt-4">
        <span className="text-lg font-semibold">ยอดชำระ</span>
        <AnimatedBaht value={t.grand_total_satang} className="text-[28px] font-semibold tracking-tight" />
      </div>
      <AnimatePresence>
        {t.savings_satang > 0 ? (
          <m.p
            key="save"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex items-center justify-center gap-1.5 rounded-pill bg-[#e9f6ee] py-2 text-sm font-semibold text-success"
          >
            <Sparkles className="size-4" aria-hidden /> ประหยัดไป <AnimatedBaht value={t.savings_satang} />
          </m.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Line({ line, item }: { line: QuoteLine; item?: CartItem }) {
  const cart = useCart();
  const badge = priceSourceBadge(line.price_source.kind, line.price_source.label);
  const bad = line.availability.status !== "ok";
  const name = item?.product.name ?? `สินค้า #${line.variant_id}`;
  return (
    <m.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -40, transition: { duration: 0.25 } }}
      transition={{ duration: 0.4, ease: EASE }}
      className="flex gap-4 py-5"
    >
      <Link href={item ? `/p/${item.product.slug}` : "#"} className="relative size-24 shrink-0 overflow-hidden rounded-[16px] bg-canvas-alt md:size-28">
        {item?.product.image ? <Img src={item.product.image.url} alt={item.product.image.alt || name} fill sizes="112px" className="object-cover" /> : null}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={item ? `/p/${item.product.slug}` : "#"} className="line-clamp-2 font-semibold leading-snug hover:underline">
              {name}
            </Link>
            {item?.variant.name ? <p className="text-sm text-ink-2">{item.variant.name}</p> : null}
          </div>
          <AnimatedBaht value={line.line_total_satang} className="shrink-0 text-[17px] font-semibold" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {badge ? <Badge tone={line.price_source.kind === "flash_sale" ? "sale" : "accent"}>{badge}</Badge> : null}
          <span className="text-sm">
            <Price value={line.unit_price_satang} strike={line.lowest_30d_satang} size="sm" sale={!!badge} /> <span className="text-ink-2">/ ชิ้น</span>
          </span>
        </div>
        {line.adjustments.map((a) => (
          <p key={a.promotion_id} className="mt-1 inline-flex items-center gap-1 text-sm text-success">
            <Sparkles className="size-3.5" aria-hidden /> {a.label} {formatDiscount(a.amount_satang)}
          </p>
        ))}
        {bad ? (
          <p className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-danger" role="alert">
            <CircleAlert className="size-4" aria-hidden />
            {line.availability.status === "out_of_stock"
              ? "สินค้าหมด — นำออกเพื่อชำระเงิน"
              : line.availability.status === "insufficient_stock"
                ? `เหลือเพียง ${line.availability.available_qty} ชิ้น — ลดจำนวนเพื่อชำระเงิน`
                : "สินค้านี้ไม่พร้อมขาย"}
          </p>
        ) : item?.stock_level === "low" ? (
          <p className="mt-1 text-xs text-warning">เหลือไม่กี่ชิ้น</p>
        ) : null}
        <div className="mt-auto flex items-center justify-between pt-3">
          <QtyStepper value={line.qty} size="sm" max={Math.max(1, item?.max_qty ?? 999)} onChange={(n) => cart.setQty(line.variant_id, n)} disabled={cart.busy} />
          <button type="button" onClick={() => cart.remove(line.variant_id)} className="inline-flex items-center gap-1 rounded-pill px-2 py-1 text-sm text-ink-2 transition hover:bg-canvas-alt hover:text-danger" aria-label={`นำ ${name} ออกจากตะกร้า`}>
            <Trash2 className="size-4" aria-hidden /> <span className="hidden sm:inline">นำออก</span>
          </button>
        </div>
      </div>
    </m.li>
  );
}

function CartViewInner() {
  const cart = useCart();
  const { me } = useSession();
  const { quote, loading } = useLiveQuote(cart.cart);
  const items = useMemo(() => new Map((cart.cart?.items ?? []).map((i) => [i.variant_id, i])), [cart.cart]);
  const summaryRef = useRef<HTMLDivElement>(null);

  if (!cart.ready) {
    return (
      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="size-24 rounded-[16px]" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-72 rounded-[24px]" />
      </div>
    );
  }
  if (!cart.cart || !quote || cart.cart.items.length === 0) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <m.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mx-auto grid size-20 place-items-center rounded-full bg-canvas-alt">
          <ShoppingBag className="size-9" aria-hidden />
        </m.span>
        <h2 className="mt-5 text-2xl font-semibold">ตะกร้ายังว่างอยู่</h2>
        <p className="mt-1 text-ink-2">ดูดีล Flash Sale และโค้ดส่วนลดล่าสุดได้เลย</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/" className="btn btn-primary">
            เลือกซื้อสินค้า
          </Link>
          <Link href="/promotions" className="btn btn-secondary">
            ดูโปรโมชัน
          </Link>
        </div>
      </div>
    );
  }

  const fs = freeShipProgress(quote);
  const blocked = blockingLines(quote).length > 0;
  const otherHints = quote.hints.filter((h) => h.kind !== "free_shipping_gap" && !(h.kind === "login_for_member_price" && me));

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-14">
      <div className="min-w-0">
        {fs ? (
          <div className="mb-4 rounded-[18px] bg-accent-soft p-4">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-link">
              <Truck className="size-5" aria-hidden /> {fs.hint.message}
            </p>
            <div className="mt-2.5 h-2 overflow-hidden rounded-pill bg-white">
              <m.div className="h-full rounded-pill bg-accent" initial={false} animate={{ width: `${fs.pct}%` }} transition={{ duration: 0.8, ease: EASE }} />
            </div>
          </div>
        ) : quote.shipping.discount_satang > 0 ? (
          <p className="mb-4 flex items-center gap-2 rounded-[18px] bg-[#e9f6ee] p-4 text-[15px] font-semibold text-success">
            <Truck className="size-5" aria-hidden /> ยินดีด้วย! ออเดอร์นี้ส่งฟรี
          </p>
        ) : null}
        {otherHints.map((h, i) => {
          const qb = qtyGap(h, quote);
          return (
          <p key={i} className="mb-3 flex items-center gap-2 rounded-[14px] bg-canvas-alt px-4 py-3 text-sm">
            {h.kind === "login_for_member_price" ? <Lock className="size-4 text-link" aria-hidden /> : <Sparkles className="size-4 text-sale" aria-hidden />}
            <span className="flex-1">{h.message}</span>
            {h.kind === "login_for_member_price" ? (
              <Link href="/login?next=/cart" className="font-semibold text-link hover:underline">
                เข้าสู่ระบบ
              </Link>
            ) : qb ? (
              <m.button
                type="button"
                whileTap={{ scale: 0.92 }}
                disabled={cart.busy}
                onClick={() => cart.setQty(qb.variantId, qb.qty)}
                className="shrink-0 rounded-pill bg-ink px-3 py-1 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-40"
                aria-label={`เพิ่มอีก ${qb.add} ชิ้น`}
              >
                +{qb.add}
              </m.button>
            ) : null}
          </p>
          );
        })}
        <ul className={clsx("divide-y divide-hairline-soft border-y border-hairline-soft transition-opacity", loading && "opacity-70")} aria-busy={loading}>
          <AnimatePresence initial={false}>
            {quote.lines.map((l) => (
              <Line key={l.variant_id} line={l} item={items.get(l.variant_id)} />
            ))}
          </AnimatePresence>
        </ul>
      </div>

      <aside ref={summaryRef} className="lg:sticky lg:top-[120px] lg:self-start" aria-label="สรุปคำสั่งซื้อ">
        <div className="rounded-[24px] bg-canvas-alt p-5 md:p-6">
          <h2 className="mb-4 text-xl font-semibold">สรุปคำสั่งซื้อ</h2>
          <CouponBox quote={quote} />
          <div className="mt-5">
            <Totals quote={quote} />
          </div>
          <Link
            href={blocked ? "#" : "/checkout"}
            aria-disabled={blocked}
            onClick={(e) => blocked && e.preventDefault()}
            className={clsx("btn btn-primary mt-5 h-[52px] w-full text-[17px]", blocked && "pointer-events-none opacity-40")}
          >
            {me ? "ดำเนินการชำระเงิน" : "เข้าสู่ระบบเพื่อชำระเงิน"}
          </Link>
          {blocked ? <p className="mt-2 text-center text-sm text-danger">มีสินค้าที่สต็อกไม่พอ กรุณาแก้ไขก่อนชำระเงิน</p> : null}
          <p className="mt-3 text-center text-xs text-ink-2">ราคาและส่วนลดยืนยันอีกครั้งตอนสั่งซื้อ</p>
        </div>
      </aside>

      {/* mobile sticky checkout bar */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-hairline-soft bg-white/85 backdrop-blur-xl lg:hidden">
        <div className="container-page flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-2">ยอดชำระ</p>
            <AnimatedBaht value={quote.totals.grand_total_satang} className="text-xl font-semibold" />
            {quote.totals.savings_satang > 0 ? <p className="text-xs font-medium text-success">ประหยัด {formatBaht(quote.totals.savings_satang)}</p> : null}
          </div>
          <Link href={blocked ? "#" : "/checkout"} aria-disabled={blocked} className={clsx("btn btn-primary h-12 px-6", blocked && "pointer-events-none opacity-40")}>
            ชำระเงิน
          </Link>
        </div>
      </div>
      <div className="h-20 lg:hidden" aria-hidden />
    </div>
  );
}

/** domMax (drag / layout) is loaded lazily for this subtree only. */
export function CouponBox(props: React.ComponentProps<typeof CouponBoxInner>) {
  return (
    <MaxMotion>
      <CouponBoxInner {...props} />
    </MaxMotion>
  );
}

/** The cart page animates with motion (lazy domMax). */
export function CartView() {
  return (
    <MaxMotion>
      <CartViewInner />
    </MaxMotion>
  );
}
