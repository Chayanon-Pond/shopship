"use client";

/** Packing station (iPad-first): queue of paid/packing orders and a big-tap checklist. */
import clsx from "clsx";
import { Check, ChevronRight, PackageCheck, PackageOpen, Printer, RefreshCw, Truck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createShipment, getOrder, listOrders, setOrderStatus, type AdminOrder } from "@/lib/api/admin";
import { useApi } from "@/lib/admin/hooks";
import { fmtDateTime } from "@/lib/admin/format";
import { OrderStatusBadge } from "../bits";
import { errorMessage, useToast } from "../overlay";
import { useSession } from "../session";
import { Button, EmptyState, ErrorState, PageFallback, PageHeader, Skeleton } from "../ui";
import { labelHref } from "./order-detail";

export function PackingQueuePage() {
  const res = useApi(
    () => Promise.all([listOrders({ status: "packing", per_page: 50 }), listOrders({ status: "paid", per_page: 100 })]).then(([a, b]) => ({ data: [...a.data, ...b.data] })),
    "packq",
  );
  const { reload } = res;
  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);
  const rows = [...(res.data?.data ?? [])].sort((a, b) => (a.status === b.status ? Date.parse(a.paid_at ?? a.created_at) - Date.parse(b.paid_at ?? b.created_at) : a.status === "packing" ? -1 : 1));
  return (
    <div>
      <PageHeader
        title="แพ็คของ"
        subtitle="ออเดอร์ที่ชำระแล้ว เรียงจากเก่าสุด · รีเฟรชทุก 30 วินาที"
        actions={
          <Button icon={RefreshCw} onClick={reload} loading={res.loading} size="lg">
            รีเฟรช
          </Button>
        }
      />
      {res.error ? (
        <ErrorState message={errorMessage(res.error)} onRetry={reload} />
      ) : !res.data ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-[16px]" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-[18px] bg-surface">
          <EmptyState icon={PackageCheck} title="แพ็คครบทุกออเดอร์แล้ว" body="ออเดอร์ใหม่ที่ชำระเงินจะขึ้นที่นี่อัตโนมัติ" />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((o) => (
            <li key={o.order_no}>
              <Link href={`/admin/packing/${o.order_no}`} className="flex min-h-28 items-center gap-4 rounded-[18px] border border-hairline-soft bg-surface p-5 shadow-[var(--shadow-tile)] transition-transform active:scale-[0.99]">
                <span className={clsx("flex size-14 shrink-0 items-center justify-center rounded-[14px]", o.status === "packing" ? "bg-[#f3eefc] text-[#6e3fbf]" : "bg-accent-soft text-link")}>
                  {o.status === "packing" ? <PackageOpen className="size-7" aria-hidden /> : <PackageCheck className="size-7" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold tabular-nums text-ink">{o.order_no}</span>
                  <span className="block truncate text-sm text-ink-2">
                    {o.customer.name} · {o.item_count} ชิ้น
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-ink-2">
                    <OrderStatusBadge status={o.status} /> ชำระ {fmtDateTime(o.paid_at)}
                  </span>
                </span>
                <ChevronRight className="size-6 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PackingViewPage() {
  const { orderNo } = useParams<{ orderNo: string }>();
  const res = useApi(() => getOrder(decodeURIComponent(orderNo)), `pack${orderNo}`);
  if (res.error) return <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />;
  if (!res.data) return <PageFallback />;
  return <Packing key={res.data.order_no} order={res.data} reload={res.reload} />;
}

function Packing({ order: o, reload }: { order: AdminOrder; reload: () => void }) {
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(o.shipment ? labelHref(o) : null);
  const total = o.items.reduce((s, i) => s + i.qty, 0);
  const done = o.items.reduce((s, i) => s + Math.min(i.qty, picked[i.variant_id] ?? 0), 0);
  const complete = done === total;
  const canFulfil = can("orders:fulfil");

  const tap = (vid: number, qty: number) => setPicked((p) => ({ ...p, [vid]: (p[vid] ?? 0) >= qty ? 0 : (p[vid] ?? 0) + 1 }));
  const all = (vid: number, qty: number) => setPicked((p) => ({ ...p, [vid]: (p[vid] ?? 0) >= qty ? 0 : qty }));

  async function start() {
    setBusy(true);
    try {
      await setOrderStatus(o.order_no, "packing");
      toast("เริ่มแพ็คแล้ว");
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function ship() {
    setBusy(true);
    try {
      const s = await createShipment(o.order_no);
      toast(`เลขพัสดุ ${s.tracking_no}`);
      const url = labelHref({ ...o, shipment: { carrier: s.carrier, tracking_no: s.tracking_no, status: s.status, label_url: s.label_url } }, s.id);
      setLabelUrl(url);
      window.open(url, "_blank", "noopener");
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader back={{ href: "/admin/packing", label: "คิวแพ็คของ" }} title={<span className="tabular-nums">{o.order_no}</span>} subtitle={<span className="inline-flex items-center gap-2"><OrderStatusBadge status={o.status} />{o.shipping_address.recipient_name} · {o.shipping_address.province}</span>} />

      {o.customer_note ? <div className="mb-4 rounded-[14px] bg-sale-soft px-4 py-3 text-base text-ink"><b>หมายเหตุลูกค้า:</b> {o.customer_note}</div> : null}

      <div className="mb-3 flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-canvas-alt">
          <div className={clsx("h-full rounded-full transition-[width] duration-300", complete ? "bg-success" : "bg-accent")} style={{ width: `${(done / total) * 100}%` }} />
        </div>
        <span className="text-lg font-semibold tabular-nums">
          {done}/{total}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        {o.items.map((it) => {
          const n = Math.min(it.qty, picked[it.variant_id] ?? 0);
          const ok = n === it.qty;
          return (
            <li key={it.variant_id}>
              <div className={clsx("flex items-stretch overflow-hidden rounded-[18px] border-2 bg-surface transition-colors", ok ? "border-success" : "border-hairline-soft")}>
                <button type="button" onClick={() => tap(it.variant_id, it.qty)} disabled={o.status !== "packing"} className="flex min-h-24 flex-1 items-center gap-4 p-4 text-left active:bg-canvas-alt disabled:cursor-default" aria-label={`หยิบ ${it.product_name} ${it.variant_name} (${n}/${it.qty})`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.image_url || "/mock/canvas-tote.svg"} alt="" className="size-20 shrink-0 rounded-[12px] border border-hairline-soft object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-semibold leading-snug text-ink">{it.product_name}</span>
                    <span className="block text-base text-ink-2">{it.variant_name}</span>
                    <span className="mt-0.5 block font-mono text-sm text-ink-2">{it.sku}</span>
                  </span>
                  <span className={clsx("text-3xl font-bold tabular-nums", ok ? "text-success" : "text-ink")}>
                    {n}
                    <span className="text-lg font-medium text-ink-2">/{it.qty}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => all(it.variant_id, it.qty)}
                  disabled={o.status !== "packing"}
                  className={clsx("flex w-20 shrink-0 items-center justify-center border-l-2 transition-colors disabled:opacity-40", ok ? "border-success bg-success text-white" : "border-hairline-soft text-ink-3 active:bg-canvas-alt")}
                  aria-label={ok ? "ยกเลิกการติ๊ก" : "หยิบครบ"}
                >
                  <Check className="size-9" strokeWidth={3} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="pb-safe sticky bottom-0 z-30 -mx-3 mt-5 border-t border-hairline-soft bg-surface/95 backdrop-blur-xl sm:mx-0 sm:rounded-t-[18px] sm:border-x">
        <div className="flex gap-3 px-4 py-3">
          {!canFulfil ? (
            <p className="text-sm text-ink-2">ไม่มีสิทธิ์จัดส่ง</p>
          ) : o.status === "paid" ? (
            <Button variant="primary" size="lg" icon={PackageOpen} loading={busy} onClick={start} className="flex-1">
              เริ่มแพ็คออเดอร์นี้
            </Button>
          ) : o.status === "packing" ? (
            <Button variant="primary" size="lg" icon={Truck} loading={busy} disabled={!complete} onClick={ship} className="flex-1">
              {complete ? "สร้างใบส่ง + พิมพ์ใบปะหน้า" : `หยิบให้ครบก่อน (เหลือ ${total - done})`}
            </Button>
          ) : (
            <>
              {labelUrl ? (
                <a href={labelUrl} target="_blank" rel="noreferrer" className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-[14px] border border-hairline bg-surface text-base font-medium text-ink">
                  <Printer className="size-5" aria-hidden /> พิมพ์ใบปะหน้าอีกครั้ง
                </a>
              ) : null}
              <Button variant="primary" size="lg" onClick={() => router.push("/admin/packing")} className="flex-1">
                ออเดอร์ถัดไป
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
