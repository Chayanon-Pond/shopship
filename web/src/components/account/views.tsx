"use client";

import { clsx } from "clsx";
import { m } from "motion/react";
import { BadgePercent, Check, ChevronRight, Crown, Heart, LogOut, MapPin, Package, Pencil, Star, Trash2, Truck, Users } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import * as api from "@/lib/api/storefront";
import type { Address, ListEnvelope, Order, OrderStatus, OrderSummary, ProductCard, Tracking } from "@/lib/api/types";
import { formatBaht, formatDiscount } from "@/lib/money";
import { promoCopy, tierLabel } from "@/lib/site";
import { ProductGrid } from "@/components/product/grid";
import { errorText } from "@/components/store/cart";
import { useRequireLogin, useSession } from "@/components/store/session";
import { useToast } from "@/components/store/toast";
import { EASE, Reveal, Sheet } from "@/components/ui/motion";
import { Badge, Img, Skeleton } from "@/components/ui/primitives";
import { AddressForm, addressLines } from "./address-form";
import { MaxMotion } from "@/components/ui/motion-lazy";

export const STATUS: Record<OrderStatus, { label: string; tone: "neutral" | "sale" | "accent" | "success" | "dark" }> = {
  pending_payment: { label: "รอชำระเงิน", tone: "sale" },
  paid: { label: "ชำระแล้ว", tone: "accent" },
  packing: { label: "กำลังแพ็ก", tone: "accent" },
  shipped: { label: "จัดส่งแล้ว", tone: "accent" },
  delivered: { label: "ได้รับแล้ว", tone: "success" },
  completed: { label: "สำเร็จ", tone: "success" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
  refunded: { label: "คืนเงินแล้ว", tone: "neutral" },
};
const FLOW: OrderStatus[] = ["pending_payment", "paid", "packing", "shipped", "delivered"];
const dt = (iso: string) => new Date(iso).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const NAV = [
  ["/account", "ภาพรวม"],
  ["/account/orders", "คำสั่งซื้อ"],
  ["/account/addresses", "ที่อยู่"],
  ["/account/wishlist", "รายการโปรด"],
] as const;

function AccountShellInner({ title, children }: { title: string; children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="container-page pb-16 pt-8 md:pt-12">
      <nav aria-label="บัญชี" className="no-scrollbar -mx-[var(--page-gutter)] mb-6 flex gap-1 overflow-x-auto px-[var(--page-gutter)]">
        {NAV.map(([href, label]) => {
          const on = href === "/account" ? path === href : path.startsWith(href);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined} className={clsx("relative shrink-0 rounded-pill px-4 py-2 text-sm font-medium transition", on ? "text-white" : "text-ink-2 hover:text-ink")}>
              {on ? <m.span layoutId="acct-nav" className="absolute inset-0 rounded-pill bg-ink" transition={{ duration: 0.35, ease: EASE }} /> : null}
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </nav>
      <h1 className="mb-6 text-[34px] font-semibold tracking-[-0.03em] md:text-[48px]">{title}</h1>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ overview */
export function AccountOverview() {
  const { me, ready, signOut, setMe } = useRequireLogin();
  const router = useRouter();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [pw, setPw] = useState(false);
  const [recent, setRecent] = useState<OrderSummary[] | null>(null);
  useEffect(() => {
    if (me) api.getOrders(1).then((r) => setRecent(r.data.slice(0, 3))).catch(() => setRecent([]));
  }, [me]);
  if (!ready || !me) return <Skeleton className="h-80 rounded-[24px]" />;
  const tier = promoCopy.member.tiers.find((t) => t.tier === me.tier);
  const isTrade = !!me.group;

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Reveal className="rounded-[24px] bg-canvas-alt p-6 lg:col-span-2">
        <div className="flex items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#2997ff] to-[#0058d6] text-xl font-semibold text-white">{me.name.slice(0, 1)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold">{me.name}</p>
            <p className="truncate text-sm text-ink-2">{me.email}</p>
            {me.phone ? <p className="text-sm text-ink-2">{me.phone}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="dark">
                <Crown className="size-3" aria-hidden /> {tierLabel[me.tier] ?? me.tier}
              </Badge>
              {me.group ? (
                <Badge tone="accent">
                  <Users className="size-3" aria-hidden /> {me.group.name}
                </Badge>
              ) : null}
              {!me.email_verified ? <Badge tone="sale">ยังไม่ยืนยันอีเมล</Badge> : null}
            </div>
          </div>
          <button type="button" onClick={() => setEdit(true)} className="btn btn-secondary h-9 bg-white px-3 text-sm">
            <Pencil className="size-3.5" aria-hidden /> แก้ไข
          </button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[18px] bg-white p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Crown className="size-4 text-[#bf8f00]" aria-hidden /> สิทธิ์ระดับ {tierLabel[me.tier]}
            </p>
            <p className="mt-1 text-sm text-ink-2">{tier?.perk ?? "สะสมยอดซื้อเพื่อเลื่อนระดับสมาชิกและรับราคาพิเศษ"}</p>
          </div>
          <div className="rounded-[18px] bg-white p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <BadgePercent className="size-4 text-link" aria-hidden /> {isTrade ? `กลุ่ม ${me.group!.name}` : "ราคาส่ง"}
            </p>
            <p className="mt-1 text-sm text-ink-2">
              {isTrade ? "ได้ราคาส่งตามจำนวนอัตโนมัติ + ใช้โค้ดลูกค้าขายส่งลดเพิ่มได้" : `${promoCopy.trade.tiers.join(" · ")} ในสินค้าที่มีป้ายราคาส่ง`}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => setPw(true)} className="btn btn-secondary h-10 bg-white text-sm">
            เปลี่ยนรหัสผ่าน
          </button>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              toast({ tone: "ok", text: "ออกจากระบบแล้ว" });
              router.push("/");
            }}
            className="btn btn-secondary h-10 bg-white text-sm text-danger"
          >
            <LogOut className="size-4" aria-hidden /> ออกจากระบบ
          </button>
        </div>
      </Reveal>
      <Reveal delay={0.08} className="rounded-[24px] bg-canvas-alt p-6">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-semibold">คำสั่งซื้อล่าสุด</p>
          <Link href="/account/orders" className="text-sm text-link hover:underline">
            ทั้งหมด
          </Link>
        </div>
        {recent === null ? <Skeleton className="h-28" /> : recent.length ? recent.map((o) => <OrderRow key={o.order_no} o={o} compact />) : <p className="text-sm text-ink-2">ยังไม่มีคำสั่งซื้อ</p>}
      </Reveal>
      <div className="grid gap-3 sm:grid-cols-3 lg:col-span-3">
        {(
          [
            ["/account/orders", "คำสั่งซื้อและการจัดส่ง", Package],
            ["/account/addresses", "สมุดที่อยู่", MapPin],
            ["/account/wishlist", "รายการโปรด", Heart],
          ] as const
        ).map(([href, label, Icon]) => (
          <Link key={href} href={href} className="group flex items-center gap-3 rounded-[20px] border border-hairline-soft p-5 transition hover:bg-canvas-alt">
            <Icon className="size-5" aria-hidden />
            <span className="flex-1 font-medium">{label}</span>
            <ChevronRight className="size-4 text-ink-3 transition group-hover:translate-x-1" aria-hidden />
          </Link>
        ))}
      </div>

      <Sheet open={edit} onClose={() => setEdit(false)} title="แก้ไขข้อมูลส่วนตัว">
        <ProfileForm
          onDone={(m) => {
            setMe(m);
            setEdit(false);
            toast({ tone: "ok", text: "บันทึกแล้ว" });
          }}
        />
      </Sheet>
      <Sheet open={pw} onClose={() => setPw(false)} title="เปลี่ยนรหัสผ่าน">
        <PasswordForm
          onDone={() => {
            setPw(false);
            toast({ tone: "ok", text: "เปลี่ยนรหัสผ่านแล้ว" });
          }}
        />
      </Sheet>
    </div>
  );
}

function ProfileForm({ onDone }: { onDone: (m: NonNullable<ReturnType<typeof useSession>["me"]>) => void }) {
  const { me } = useSession();
  const [name, setName] = useState(me?.name ?? "");
  const [phone, setPhone] = useState(me?.phone ?? "");
  const [consent, setConsent] = useState(me?.marketing_consent ?? false);
  const [err, setErr] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          onDone(await api.updateMe({ name, phone, marketing_consent: consent }));
        } catch (er) {
          setErr(errorText(er));
        }
      }}
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium">ชื่อ</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">เบอร์โทรศัพท์</span>
        <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        รับข่าวสาร โค้ดส่วนลด และโปรโมชันทางอีเมล
      </label>
      {err ? <p className="text-sm text-danger">{err}</p> : null}
      <button type="submit" className="btn btn-primary w-full">
        บันทึก
      </button>
    </form>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (next.length < 8) return setErr("รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร");
        try {
          await api.changePassword(cur, next);
          onDone();
        } catch (er) {
          setErr(errorText(er));
        }
      }}
    >
      <label className="block">
        <span className="mb-1 block text-sm font-medium">รหัสผ่านปัจจุบัน</span>
        <input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</span>
        <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required minLength={8} />
      </label>
      {err ? <p className="text-sm text-danger">{err}</p> : null}
      <button type="submit" className="btn btn-primary w-full">
        เปลี่ยนรหัสผ่าน
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ orders */
function OrderRow({ o, compact }: { o: OrderSummary; compact?: boolean }) {
  const st = STATUS[o.status];
  return (
    <Link href={`/account/orders/${encodeURIComponent(o.order_no)}`} className={clsx("group flex items-center gap-4 transition", compact ? "py-2" : "rounded-[20px] border border-hairline-soft p-4 hover:bg-canvas-alt")}>
      <span className={clsx("relative shrink-0 overflow-hidden rounded-[14px] bg-canvas-alt", compact ? "size-12" : "size-16")}>
        {o.first_item_image ? <Img src={o.first_item_image.url} alt="" fill sizes="64px" className="object-cover" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{o.order_no}</span>
        <span className="block text-sm text-ink-2">
          {o.item_count} ชิ้น · {dt(o.created_at)}
        </span>
      </span>
      <span className="text-right">
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="mt-1 block font-semibold tabular-nums">{formatBaht(o.grand_total_satang)}</span>
      </span>
    </Link>
  );
}

export function OrdersList() {
  const { me, ready } = useRequireLogin();
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [data, setData] = useState<ListEnvelope<OrderSummary> | null>(null);
  useEffect(() => {
    if (!me) return;
    api.getOrders(1, status || undefined).then(setData).catch(() => setData({ data: [], meta: { page: 1, per_page: 24, total: 0, total_pages: 0 } }));
  }, [me, status]);
  if (!ready || !me) return <Skeleton className="h-64 rounded-[24px]" />;
  const tabs: [OrderStatus | "", string][] = [
    ["", "ทั้งหมด"],
    ["pending_payment", "รอชำระ"],
    ["paid", "ชำระแล้ว"],
    ["shipped", "กำลังส่ง"],
    ["delivered", "ได้รับแล้ว"],
    ["cancelled", "ยกเลิก"],
  ];
  return (
    <div>
      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
        {tabs.map(([s, l]) => (
          <button key={l} type="button" onClick={() => setStatus(s)} aria-pressed={status === s} className={clsx("shrink-0 rounded-pill px-3.5 py-1.5 text-sm font-medium transition", status === s ? "bg-accent-soft text-link" : "bg-canvas-alt hover:bg-hairline-soft")}>
            {l}
          </button>
        ))}
      </div>
      {!data ? (
        <Skeleton className="h-40 rounded-[20px]" />
      ) : data.data.length ? (
        <ul className="space-y-3">
          {data.data.map((o, i) => (
            <Reveal as="li" key={o.order_no} delay={Math.min(i, 5) * 0.05}>
              <OrderRow o={o} />
            </Reveal>
          ))}
        </ul>
      ) : (
        <div className="rounded-[24px] bg-canvas-alt p-10 text-center">
          <Package className="mx-auto size-10 text-ink-3" aria-hidden />
          <p className="mt-3 font-semibold">ยังไม่มีคำสั่งซื้อ</p>
          <Link href="/" className="btn btn-primary mt-4">
            เริ่มช้อป
          </Link>
        </div>
      )}
    </div>
  );
}

export function OrderDetailView() {
  const { me, ready } = useRequireLogin();
  const { orderNo } = useParams<{ orderNo: string }>();
  const toast = useToast();
  const [o, setO] = useState<Order | null>(null);
  const [err, setErr] = useState("");
  const [track, setTrack] = useState<Tracking | null>(null);
  useEffect(() => {
    if (!me) return;
    api
      .getOrder(orderNo)
      .then((x) => {
        setO(x);
        if (x.shipment) api.getTracking(orderNo).then(setTrack).catch(() => {});
      })
      .catch((e) => setErr(errorText(e)));
  }, [me, orderNo]);
  if (!ready || !me || (!o && !err)) return <Skeleton className="h-96 rounded-[24px]" />;
  if (!o) return <p className="rounded-[24px] bg-canvas-alt p-10 text-center">{err || "ไม่พบคำสั่งซื้อ"}</p>;

  const st = STATUS[o.status];
  const reached = (s: OrderStatus) => o.timeline.find((t) => t.status === s);
  const off = o.status === "cancelled" || o.status === "refunded";
  const curIdx = FLOW.indexOf(o.status === "completed" ? "delivered" : o.status);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-base font-semibold tracking-wider">{o.order_no}</span>
          <Badge tone={st.tone} className="text-sm">
            {st.label}
          </Badge>
          <span className="text-sm text-ink-2">สั่งเมื่อ {dt(o.created_at)}</span>
        </div>

        {/* status timeline */}
        <section aria-label="สถานะคำสั่งซื้อ" className="rounded-[24px] bg-canvas-alt p-5 md:p-6">
          {off ? (
            <p className="font-semibold">
              {st.label} {o.cancelled_at ? `· ${dt(o.cancelled_at)}` : ""}
            </p>
          ) : (
            <ol className="grid grid-cols-5 gap-1">
              {FLOW.map((s, i) => {
                const done = i <= curIdx;
                const at = reached(s);
                return (
                  <li key={s} className="relative flex flex-col items-center text-center">
                    {i > 0 ? (
                      <span className="absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2 bg-hairline">
                        <m.span className="block h-full origin-left bg-success" initial={{ scaleX: 0 }} animate={{ scaleX: done ? 1 : 0 }} transition={{ duration: 0.6, delay: i * 0.15, ease: EASE }} />
                      </span>
                    ) : null}
                    <m.span
                      initial={{ scale: 0.6 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: i * 0.15 }}
                      className={clsx("relative z-10 grid size-7 place-items-center rounded-full", done ? "bg-success text-white" : "bg-white text-ink-3 ring-1 ring-hairline")}
                    >
                      {done ? <Check className="size-4" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" />}
                    </m.span>
                    <span className={clsx("mt-2 text-[11px] font-medium leading-tight md:text-xs", !done && "text-ink-3")}>{STATUS[s].label}</span>
                    {at ? <span className="mt-0.5 hidden text-[10px] text-ink-2 md:block">{dt(at.at)}</span> : null}
                  </li>
                );
              })}
            </ol>
          )}
          {o.shipment ? (
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[16px] bg-white p-4">
              <Truck className="size-5" aria-hidden />
              <div className="flex-1">
                <p className="text-sm text-ink-2">Flash Express · เลขพัสดุ</p>
                <p className="font-mono font-semibold tracking-wider">{o.shipment.tracking_no}</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary h-9 text-sm"
                onClick={async () => {
                  await navigator.clipboard?.writeText(o.shipment!.tracking_no).catch(() => {});
                  toast({ tone: "ok", text: "คัดลอกเลขพัสดุแล้ว" });
                }}
              >
                คัดลอก
              </button>
              {track?.events.length ? (
                <ul className="w-full space-y-1 border-t border-hairline-soft pt-3 text-sm">
                  {track.events.map((e, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>
                        {e.description} {e.location ? <span className="text-ink-2">· {e.location}</span> : null}
                      </span>
                      <span className="shrink-0 text-ink-2">{dt(e.occurred_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {o.status === "pending_payment" ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/checkout/pay/${encodeURIComponent(o.order_no)}`} className="btn btn-primary">
                ชำระเงินตอนนี้
              </Link>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  try {
                    setO(await api.cancelOrder(o.order_no));
                    toast({ tone: "ok", text: "ยกเลิกคำสั่งซื้อแล้ว" });
                  } catch (e) {
                    toast({ tone: "error", text: errorText(e) });
                  }
                }}
              >
                ยกเลิกคำสั่งซื้อ
              </button>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="items-title">
          <h2 id="items-title" className="mb-2 text-xl font-semibold">
            สินค้า
          </h2>
          <ul className="divide-y divide-hairline-soft">
            {o.items.map((i) => (
              <li key={i.variant_id} className="flex gap-4 py-4">
                <Link href={`/p/${i.product_slug}`} className="relative size-20 shrink-0 overflow-hidden rounded-[14px] bg-canvas-alt">
                  {i.image_url ? <Img src={i.image_url} alt={i.product_name} fill sizes="80px" className="object-cover" /> : null}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${i.product_slug}`} className="font-semibold hover:underline">
                    {i.product_name}
                  </Link>
                  <p className="text-sm text-ink-2">
                    {i.variant_name ? `${i.variant_name} · ` : ""}{i.qty} × {formatBaht(i.unit_price_satang)}
                  </p>
                  {i.price_source.kind !== "list" ? <Badge tone="accent" className="mt-1">{i.price_source.label}</Badge> : null}
                  {i.line_discount_satang ? <p className="text-sm text-success">ส่วนลด {formatDiscount(i.line_discount_satang)}</p> : null}
                </div>
                <p className="font-semibold tabular-nums">{formatBaht(i.line_total_satang)}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-[120px] lg:self-start">
        <div className="rounded-[24px] bg-canvas-alt p-5">
          <h2 className="mb-3 font-semibold">สรุปยอด</h2>
          <dl className="space-y-1.5 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-ink-2">ราคาสินค้า</dt>
              <dd className="tabular-nums">{formatBaht(o.totals.subtotal_satang)}</dd>
            </div>
            {o.adjustments
              .filter((a) => a.layer >= 3)
              .map((a) => (
                <div key={`${a.promotion_id}-${a.layer}`} className="flex justify-between text-success">
                  <dt>{a.label}</dt>
                  <dd className="tabular-nums">{formatDiscount(a.amount_satang)}</dd>
                </div>
              ))}
            <div className="flex justify-between">
              <dt className="text-ink-2">ค่าจัดส่ง</dt>
              <dd className="tabular-nums">
                {o.totals.shipping_discount_satang >= o.totals.shipping_fee_satang && o.totals.shipping_fee_satang > 0 ? (
                  <span className="font-semibold text-success">ฟรี</span>
                ) : (
                  formatBaht(o.totals.shipping_fee_satang)
                )}
              </dd>
            </div>
            {o.totals.shipping_discount_satang > 0 && o.totals.shipping_discount_satang < o.totals.shipping_fee_satang ? (
              <div className="flex justify-between text-success">
                <dt>ส่วนลดค่าจัดส่ง</dt>
                <dd className="tabular-nums">{formatDiscount(o.totals.shipping_discount_satang)}</dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-3 flex justify-between border-t border-hairline-soft pt-3 text-lg font-semibold">
            <span>ยอดชำระ</span>
            <span className="tabular-nums">{formatBaht(o.totals.grand_total_satang)}</span>
          </div>
          {o.totals.savings_satang > 0 ? <p className="mt-2 text-sm font-semibold text-success">ประหยัดไป {formatBaht(o.totals.savings_satang)}</p> : null}
          <p className="mt-3 text-sm text-ink-2">
            ชำระด้วย {o.payment_method === "promptpay" ? "PromptPay" : "บัตร"}
            {o.coupon_code ? ` · โค้ด ${o.coupon_code}` : ""}
          </p>
        </div>
        <div className="rounded-[24px] bg-canvas-alt p-5 text-sm">
          <h2 className="mb-2 font-semibold">ที่อยู่จัดส่ง</h2>
          <p className="font-medium">{o.shipping_address.recipient_name}</p>
          <p className="text-ink-2">{o.shipping_address.phone}</p>
          <p className="mt-1">{addressLines(o.shipping_address)}</p>
          {o.customer_note ? <p className="mt-2 text-ink-2">หมายเหตุ: {o.customer_note}</p> : null}
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ addresses */
export function AddressBook() {
  const { me, ready } = useRequireLogin();
  const toast = useToast();
  const [list, setList] = useState<Address[] | null>(null);
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const load = () => api.getAddresses().then(setList).catch(() => setList([]));
  useEffect(() => {
    if (me) void load();
  }, [me]);
  if (!ready || !me || !list) return <Skeleton className="h-48 rounded-[24px]" />;
  return (
    <div>
      <ul className="grid gap-3 md:grid-cols-2">
        {list.map((a) => (
          <li key={a.id} className="rounded-[20px] border border-hairline-soft p-5">
            <p className="flex flex-wrap items-center gap-2 font-semibold">
              {a.recipient_name} {a.label ? <Badge>{a.label}</Badge> : null} {a.is_default ? <Badge tone="accent">ที่อยู่หลัก</Badge> : null}
            </p>
            <p className="mt-1 text-sm text-ink-2">{a.phone}</p>
            <p className="mt-1 text-sm">{addressLines(a)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(a)} className="btn btn-secondary h-9 text-sm">
                <Pencil className="size-3.5" aria-hidden /> แก้ไข
              </button>
              {!a.is_default ? (
                <button
                  type="button"
                  onClick={async () => {
                    await api.setDefaultAddress(a.id).catch((e) => toast({ tone: "error", text: errorText(e) }));
                    void load();
                  }}
                  className="btn btn-secondary h-9 text-sm"
                >
                  <Star className="size-3.5" aria-hidden /> ตั้งเป็นหลัก
                </button>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm("ลบที่อยู่นี้?")) return;
                  await api.deleteAddress(a.id).catch((e) => toast({ tone: "error", text: errorText(e) }));
                  void load();
                }}
                className="btn btn-secondary h-9 text-sm text-danger"
              >
                <Trash2 className="size-3.5" aria-hidden /> ลบ
              </button>
            </div>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => setEditing("new")} className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-1 rounded-[20px] border border-dashed border-hairline text-link transition hover:border-accent">
            <MapPin className="size-5" aria-hidden /> เพิ่มที่อยู่ใหม่
          </button>
        </li>
      </ul>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "เพิ่มที่อยู่ใหม่" : "แก้ไขที่อยู่"}>
        {editing ? (
          <AddressForm
            initial={editing === "new" ? undefined : editing}
            onSaved={() => {
              setEditing(null);
              toast({ tone: "ok", text: "บันทึกที่อยู่แล้ว" });
              void load();
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ wishlist */
export function WishlistView() {
  const { me, ready } = useRequireLogin();
  const [list, setList] = useState<ProductCard[] | null>(null);
  useEffect(() => {
    if (me) api.getWishlist().then((r) => setList(r.data)).catch(() => setList([]));
  }, [me]);
  if (!ready || !me || !list) return <Skeleton className="h-64 rounded-[24px]" />;
  if (!list.length)
    return (
      <div className="rounded-[24px] bg-canvas-alt p-10 text-center">
        <Heart className="mx-auto size-10 text-ink-3" aria-hidden />
        <p className="mt-3 font-semibold">ยังไม่มีรายการโปรด</p>
        <p className="text-sm text-ink-2">กดรูปหัวใจบนสินค้าที่ชอบเพื่อเก็บไว้ดูภายหลัง</p>
        <Link href="/" className="btn btn-primary mt-4">
          เลือกดูสินค้า
        </Link>
      </div>
    );
  return <ProductGrid products={list} />;
}

/** domMax (drag / layout) is loaded lazily for this subtree only. */
export function AccountShell(props: React.ComponentProps<typeof AccountShellInner>) {
  return (
    <MaxMotion>
      <AccountShellInner {...props} />
    </MaxMotion>
  );
}
