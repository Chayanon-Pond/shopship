"use client";

import { clsx } from "clsx";
import { m } from "motion/react";
import { ArrowRight, Check, CreditCard, MapPin, Plus, QrCode, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import * as api from "@/lib/api/storefront";
import type { Address, PaymentMethod, Quote, ShippingRate } from "@/lib/api/types";
import { formatBaht } from "@/lib/money";
import { AddressForm, addressLines } from "@/components/account/address-form";
import { CouponBox, Totals, useLiveQuote } from "@/components/cart/cart-view";
import { priceSourceBadge } from "@/components/cart/logic";
import { errorText, useCart } from "@/components/store/cart";
import { useRequireLogin } from "@/components/store/session";
import { useToast } from "@/components/store/toast";
import { Sheet } from "@/components/ui/motion";
import { Badge, Img, Skeleton } from "@/components/ui/primitives";
import { MaxMotion } from "@/components/ui/motion-lazy";

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="border-b border-hairline-soft py-7 first:pt-0" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-4 flex items-center gap-3 text-xl font-semibold tracking-tight">
        <span className={clsx("grid size-7 place-items-center rounded-full text-sm", done ? "bg-success text-white" : "bg-ink text-white")}>
          {done ? <Check className="size-4" aria-hidden /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CheckoutViewInner() {
  const { me, ready } = useRequireLogin();
  const cart = useCart();
  const toast = useToast();
  const router = useRouter();
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [addressId, setAddressId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("promptpay");
  const [note, setNote] = useState("");
  const [rate, setRate] = useState<ShippingRate | null>(null);
  const [placing, setPlacing] = useState(false);
  const [changed, setChanged] = useState<{ before: Quote; after: Quote } | null>(null);
  const quoteBody = useMemo(() => (addressId ? { address_id: addressId } : {}), [addressId]);
  const { quote, loading, setQuote } = useLiveQuote(cart.cart, quoteBody);
  // one Idempotency-Key per distinct order body; reused on retries of the same body
  const idem = useRef<{ sig: string; key: string } | null>(null);

  useEffect(() => {
    if (!me) return;
    api
      .getAddresses()
      .then((list) => {
        setAddresses(list);
        setAddressId((cur) => cur ?? list.find((a) => a.is_default)?.id ?? list[0]?.id ?? null);
      })
      .catch(() => setAddresses([]));
  }, [me]);

  const addr = addresses?.find((a) => a.id === addressId);
  useEffect(() => {
    if (!addr) return;
    let alive = true;
    api
      .shippingQuote(addr.postal_code)
      .then((r) => alive && setRate(r))
      .catch(() => alive && setRate(null));
    return () => {
      alive = false;
    };
  }, [addr]);

  if (!ready || !me) return <Skeleton className="h-96 rounded-[24px]" />;
  if (cart.ready && (!cart.cart || cart.cart.items.length === 0) && !placing) {
    return (
      <div className="py-16 text-center">
        <p className="text-xl font-semibold">ตะกร้าว่าง</p>
        <Link href="/" className="btn btn-primary mt-5">
          เลือกซื้อสินค้า
        </Link>
      </div>
    );
  }
  const items = new Map((cart.cart?.items ?? []).map((i) => [i.variant_id, i]));
  const blocked = !quote || quote.lines.some((l) => l.availability.status !== "ok");

  async function place(q: Quote) {
    if (!addressId) {
      toast({ tone: "error", text: "กรุณาเลือกที่อยู่จัดส่ง" });
      return;
    }
    const body = {
      address_id: addressId,
      payment_method: method,
      quote_hash: q.quote_hash,
      coupon_code: q.coupon?.status === "applied" ? q.coupon.code : undefined,
      customer_note: note.trim() || undefined,
    };
    const sig = JSON.stringify(body);
    if (!idem.current || idem.current.sig !== sig) idem.current = { sig, key: uuid() };
    setPlacing(true);
    try {
      const order = await api.createOrder(body, idem.current.key);
      void cart.refresh();
      router.push(`/checkout/pay/${encodeURIComponent(order.order_no)}?method=${method}`);
    } catch (e) {
      setPlacing(false);
      if (e instanceof ApiError && e.code === "price_changed") {
        const fresh = (e.details as { quote?: Quote } | undefined)?.quote;
        if (fresh) {
          setChanged({ before: q, after: fresh });
          return;
        }
        const re = await api.quoteCart(quoteBody).catch(() => null);
        if (re) setChanged({ before: q, after: re });
        return;
      }
      if (e instanceof ApiError && (e.code === "out_of_stock" || e.code === "limit_reached")) {
        toast({ tone: "error", text: e.message, action: { label: "กลับไปตะกร้า", href: "/cart" } });
        void cart.refresh();
        return;
      }
      toast({ tone: "error", text: errorText(e) });
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_400px] lg:gap-14">
      <div className="min-w-0">
        <Step n={1} title="ที่อยู่จัดส่ง" done={!!addr}>
          {addresses === null ? (
            <Skeleton className="h-24 rounded-[18px]" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="เลือกที่อยู่จัดส่ง">
              {addresses.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={a.id === addressId}
                  onClick={() => setAddressId(a.id)}
                  className={clsx(
                    "relative rounded-[18px] border p-4 text-left transition",
                    a.id === addressId ? "border-accent ring-1 ring-accent" : "border-hairline hover:border-ink-3",
                  )}
                >
                  <p className="flex items-center gap-2 font-semibold">
                    <MapPin className="size-4 text-ink-2" aria-hidden />
                    {a.recipient_name}
                    {a.label ? <Badge>{a.label}</Badge> : null}
                    {a.is_default ? <Badge tone="accent">หลัก</Badge> : null}
                  </p>
                  <p className="mt-1 text-sm text-ink-2">{a.phone}</p>
                  <p className="mt-1 text-sm leading-relaxed">{addressLines(a)}</p>
                  {a.id === addressId ? (
                    <m.span layoutId="addr-check" className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-accent text-white">
                      <Check className="size-3.5" aria-hidden />
                    </m.span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-[18px] border border-dashed border-hairline text-link transition hover:border-accent hover:bg-accent-soft/40"
              >
                <Plus className="size-5" aria-hidden /> เพิ่มที่อยู่ใหม่
              </button>
            </div>
          )}
        </Step>

        <Step n={2} title="การจัดส่ง" done={!!rate}>
          <div className="flex items-center gap-4 rounded-[18px] bg-canvas-alt p-4">
            <span className="grid size-11 place-items-center rounded-full bg-white">
              <Truck className="size-5" aria-hidden />
            </span>
            <div className="flex-1">
              <p className="font-semibold">Flash Express</p>
              <p className="text-sm text-ink-2">
                {rate ? `ได้รับภายใน ${rate.eta_days[0]}–${rate.eta_days[1]} วันทำการ` : addr ? "กำลังคำนวณค่าส่ง…" : "เลือกที่อยู่เพื่อคำนวณค่าส่ง"}
              </p>
            </div>
            <p className="text-right font-semibold tabular-nums">
              {quote && quote.shipping.fee_satang > 0 && quote.shipping.discount_satang >= quote.shipping.fee_satang ? (
                <>
                  <s className="mr-1 text-sm font-normal text-ink-3">{formatBaht(quote.shipping.fee_satang)}</s>
                  <span className="text-success">ฟรี</span>
                </>
              ) : quote && quote.shipping.fee_satang > 0 ? (
                formatBaht(quote.totals.shipping_satang)
              ) : rate ? (
                formatBaht(rate.fee_satang)
              ) : (
                "—"
              )}
            </p>
          </div>
        </Step>

        <Step n={3} title="วิธีชำระเงิน" done>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="วิธีชำระเงิน">
            {(
              [
                ["promptpay", "PromptPay QR", "สแกนจ่ายผ่านแอปธนาคาร ยืนยันอัตโนมัติ", QrCode],
                ["card", "บัตรเครดิต / เดบิต", "Visa · Mastercard · JCB (โหมดทดสอบ)", CreditCard],
              ] as const
            ).map(([m, t, d, Icon]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={clsx("flex items-start gap-3 rounded-[18px] border p-4 text-left transition", method === m ? "border-accent ring-1 ring-accent" : "border-hairline hover:border-ink-3")}
              >
                <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="text-sm text-ink-2">{d}</span>
                </span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={4} title="หมายเหตุถึงร้าน (ถ้ามี)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className="input min-h-24 py-3" placeholder="เช่น ฝากไว้กับ รปภ." aria-label="หมายเหตุถึงร้าน" />
        </Step>
      </div>

      <aside className="lg:sticky lg:top-[120px] lg:self-start" aria-label="สรุปคำสั่งซื้อ">
        <div className="rounded-[24px] bg-canvas-alt p-5 md:p-6">
          <h2 className="mb-4 text-xl font-semibold">คำสั่งซื้อของคุณ</h2>
          {!quote ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <ul className={clsx("mb-4 space-y-3 transition-opacity", loading && "opacity-60")}>
                {quote.lines.map((l) => {
                  const it = items.get(l.variant_id);
                  const b = priceSourceBadge(l.price_source.kind, l.price_source.label);
                  return (
                    <li key={l.variant_id} className="flex gap-3">
                      <span className="relative size-14 shrink-0 overflow-hidden rounded-[12px] bg-white">
                        {it?.product.image ? <Img src={it.product.image.url} alt="" fill sizes="56px" className="object-cover" /> : null}
                        <span className="absolute -right-0 -top-0 grid h-5 min-w-5 place-items-center rounded-bl-[8px] bg-ink px-1 text-[11px] font-semibold text-white">{l.qty}</span>
                      </span>
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="line-clamp-1 font-medium">{it?.product.name ?? `สินค้า #${l.variant_id}`}</span>
                        <span className="block text-ink-2">{it?.variant.name}</span>
                        {b ? <span className="text-xs font-semibold text-link">{b}</span> : null}
                        {l.adjustments.map((a) => (
                          <span key={a.promotion_id} className="block text-xs text-success">
                            {a.label}
                          </span>
                        ))}
                      </span>
                      <span className="text-sm font-semibold tabular-nums">{formatBaht(l.line_total_satang)}</span>
                    </li>
                  );
                })}
              </ul>
              <CouponBox quote={quote} />
              <div className="mt-4">
                <Totals quote={quote} showShippingNote={!addr} />
              </div>
              <button type="button" className="btn btn-primary mt-5 h-[52px] w-full text-[17px]" disabled={blocked || placing || loading || !addr} onClick={() => place(quote)}>
                {placing ? "กำลังสร้างคำสั่งซื้อ…" : <>สั่งซื้อและชำระเงิน <ArrowRight className="size-4" aria-hidden /></>}
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-2">
                <ShieldCheck className="size-3.5" aria-hidden /> ระบบยืนยันราคาอีกครั้งก่อนสร้างคำสั่งซื้อ
              </p>
            </>
          )}
        </div>
      </aside>

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="เพิ่มที่อยู่ใหม่">
        <AddressForm
          onSaved={(a) => {
            setAddresses((l) => [...(l ?? []).map((x) => (a.is_default ? { ...x, is_default: false } : x)), a]);
            setAddressId(a.id);
            setAddOpen(false);
          }}
        />
      </Sheet>

      <Sheet open={!!changed} onClose={() => setChanged(null)} title="ราคามีการเปลี่ยนแปลง">
        {changed ? (
          <PriceDiff
            before={changed.before}
            after={changed.after}
            names={(id) => items.get(id)?.product.name ?? `สินค้า #${id}`}
            onConfirm={() => {
              setQuote(changed.after);
              const fresh = changed.after;
              setChanged(null);
              void place(fresh);
            }}
            onBack={() => router.push("/cart")}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function PriceDiff({ before, after, names, onConfirm, onBack }: { before: Quote; after: Quote; names: (id: number) => string; onConfirm: () => void; onBack: () => void }) {
  const rows = after.lines
    .map((l) => ({ l, prev: before.lines.find((x) => x.variant_id === l.variant_id) }))
    .filter(({ l, prev }) => !prev || prev.line_total_satang !== l.line_total_satang || prev.unit_price_satang !== l.unit_price_satang);
  const diff = after.totals.grand_total_satang - before.totals.grand_total_satang;
  return (
    <div>
      <p className="text-ink-2">ระหว่างที่คุณกำลังชำระเงิน ราคาหรือโปรโมชันบางรายการเปลี่ยนไป กรุณาตรวจสอบยอดใหม่ก่อนยืนยัน</p>
      {rows.length ? (
        <ul className="mt-4 divide-y divide-hairline-soft rounded-[16px] bg-canvas-alt px-4">
          {rows.map(({ l, prev }) => (
            <li key={l.variant_id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="line-clamp-1 font-medium">{names(l.variant_id)}</span>
                {l.price_source.label ? <span className="text-xs text-ink-2">{l.price_source.label}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {prev ? <s className="mr-2 text-ink-3">{formatBaht(prev.line_total_satang)}</s> : null}
                <span className="font-semibold">{formatBaht(l.line_total_satang)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {after.coupon && after.coupon.status !== "applied" && before.coupon?.status === "applied" ? (
        <p className="mt-3 rounded-[12px] bg-[#fff6e5] p-3 text-sm text-warning">{after.coupon.message}</p>
      ) : null}
      <div className="mt-4 flex items-baseline justify-between rounded-[16px] border border-hairline-soft p-4">
        <span className="font-semibold">ยอดชำระใหม่</span>
        <span className="text-right tabular-nums">
          {diff !== 0 ? <s className="mr-2 text-ink-3">{formatBaht(before.totals.grand_total_satang)}</s> : null}
          <span className="text-2xl font-semibold">{formatBaht(after.totals.grand_total_satang)}</span>
          <span className={clsx("block text-xs", diff > 0 ? "text-danger" : "text-success")}>
            {diff > 0 ? `เพิ่มขึ้น ${formatBaht(diff)}` : diff < 0 ? `ลดลง ${formatBaht(-diff)}` : "ยอดรวมเท่าเดิม"}
          </span>
        </span>
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
        <button type="button" className="btn btn-primary flex-1" onClick={onConfirm}>
          ยืนยันและสั่งซื้อ
        </button>
        <button type="button" className="btn btn-secondary flex-1" onClick={onBack}>
          กลับไปแก้ตะกร้า
        </button>
      </div>
    </div>
  );
}

/** domMax (drag / layout) is loaded lazily for this subtree only. */
export function CheckoutView() {
  return (
    <MaxMotion>
      <CheckoutViewInner />
    </MaxMotion>
  );
}
