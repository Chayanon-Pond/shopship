"use client";

import { CheckCircle2, CircleDot, PackageCheck, Printer, Truck, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { formatBaht, formatDiscount } from "@/lib/money";
import { advanceShipment, createShipment, getOrder, setOrderStatus, shipmentLabelUrl, type AdminOrder } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { OrderStatus } from "@/lib/api/types";
import { USE_MOCKS } from "@/lib/api/client";
import { useApi } from "@/lib/admin/hooks";
import { fmtDateTime, ORDER_STATUS_LABEL, ORDER_TRANSITIONS } from "@/lib/admin/format";
import { OrderStatusBadge } from "../bits";
import { Dialog, errorMessage, useToast } from "../overlay";
import { useSession } from "../session";
import { Badge, Button, Card, ErrorState, Field, LinkButton, PageFallback, PageHeader, Textarea } from "../ui";

const TRACK_LABEL: Record<string, string> = { created: "สร้างใบส่งแล้ว", picked_up: "เข้ารับพัสดุแล้ว", in_transit: "อยู่ระหว่างขนส่ง", out_for_delivery: "กำลังนำส่ง", delivered: "ส่งถึงแล้ว" };

export function labelHref(order: AdminOrder, shipmentId?: number) {
  if (order.shipment?.label_url) return order.shipment.label_url;
  if (shipmentId && !USE_MOCKS) return shipmentLabelUrl(shipmentId);
  const t = order.shipment?.tracking_no;
  return `/admin/print/label/${order.order_no}${t ? `?tracking=${encodeURIComponent(t)}` : ""}`;
}

export function OrderDetailPage() {
  const { orderNo } = useParams<{ orderNo: string }>();
  const res = useApi(() => getOrder(decodeURIComponent(orderNo)), `o${orderNo}`);
  if (res.error) return <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />;
  if (!res.data) return <PageFallback />;
  return <OrderView order={res.data} onChange={res.mutate} reload={res.reload} />;
}

function OrderView({ order: o, onChange, reload }: { order: AdminOrder; onChange: (o: AdminOrder) => void; reload: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [move, setMove] = useState<OrderStatus | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [shipmentId, setShipmentId] = useState<number | undefined>();
  const [advanceSupported, setAdvanceSupported] = useState(true);
  const sid = shipmentId ?? o.shipment?.id;
  async function advance() {
    if (!sid) return;
    setBusy(true);
    try {
      const t = await advanceShipment(sid);
      toast(`สถานะพัสดุ: ${t.events[0]?.description ?? t.status}`); // events are newest first
      reload();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
        setAdvanceSupported(false);
        toast("ขนส่งจริงไม่รองรับการเลื่อนสถานะจำลอง", "info");
      } else toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  const moves = ORDER_TRANSITIONS[o.status].filter((t) => can(t.perm) && !(t.to === "shipped" && o.status === "packing"));

  async function doMove() {
    if (!move) return;
    setBusy(true);
    try {
      const next = await setOrderStatus(o.order_no, move, note.trim() || undefined);
      toast(`เปลี่ยนสถานะเป็น “${ORDER_STATUS_LABEL[move]}” แล้ว`);
      setMove(null);
      setNote("");
      if (next && "order_no" in next) onChange(next);
      else reload();
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
      setShipmentId(s.id);
      toast(`สร้างใบส่งแล้ว เลขพัสดุ ${s.tracking_no}`);
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  const danger = move === "cancelled" || move === "refunded";
  const addr = o.shipping_address;
  const history = o.status_history?.length ? o.status_history : o.timeline.map((t, i) => ({ from_status: i ? o.timeline[i - 1].status : null, to_status: t.status, actor_email: null, note: t.note, created_at: t.at }));

  return (
    <div>
      <PageHeader
        back={{ href: "/admin/orders", label: "คำสั่งซื้อ" }}
        title={<span className="tabular-nums">{o.order_no}</span>}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={o.status} /> สั่งเมื่อ {fmtDateTime(o.created_at)}
          </span>
        }
        actions={
          <>
            {(o.status === "paid" || o.status === "packing") && can("orders:fulfil") ? (
              <LinkButton href={`/admin/packing/${o.order_no}`} icon={PackageCheck} variant={o.status === "paid" ? "primary" : "outline"}>
                เปิดหน้าแพ็ค
              </LinkButton>
            ) : null}
            {o.status === "packing" && can("orders:fulfil") ? (
              <Button variant="primary" icon={Truck} loading={busy} onClick={ship}>
                สร้างใบส่ง
              </Button>
            ) : null}
            {o.shipment ? (
              <a href={labelHref(o, shipmentId)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-input)] border border-hairline bg-surface px-4 text-sm font-medium text-ink hover:bg-canvas-alt">
                <Printer className="size-4" aria-hidden /> พิมพ์ใบปะหน้า
              </a>
            ) : null}
            {moves.map((m) => (
              <Button key={m.to} variant={m.to === "cancelled" || m.to === "refunded" ? "danger-ghost" : "outline"} onClick={() => setMove(m.to)}>
                {m.to === "cancelled" ? "ยกเลิกคำสั่งซื้อ" : m.to === "refunded" ? "คืนเงิน" : `เปลี่ยนเป็น “${ORDER_STATUS_LABEL[m.to]}”`}
              </Button>
            ))}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={`สินค้า (${o.items.reduce((s, i) => s + i.qty, 0)} ชิ้น)`} pad={false}>
            <ul className="divide-y divide-hairline-soft">
              {o.items.map((it) => (
                <li key={it.variant_id} className="flex items-start gap-3 px-4 py-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.image_url || "/mock/canvas-tote.svg"} alt="" className="size-14 shrink-0 rounded-[10px] border border-hairline-soft object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{it.product_name}</p>
                    <p className="text-xs text-ink-2">
                      {it.variant_name} · <span className="font-mono">{it.sku}</span>
                    </p>
                    {it.price_source.kind !== "list" ? <Badge tone="purple" className="mt-1">{it.price_source.label}</Badge> : null}
                  </div>
                  <div className="text-right text-sm">
                    <p className="tabular-nums text-ink-2">
                      {it.qty} × {it.unit_price_satang !== it.list_unit_price_satang ? <span className="price-strike mr-1">{formatBaht(it.list_unit_price_satang)}</span> : null}
                      {formatBaht(it.unit_price_satang)}
                    </p>
                    {it.line_discount_satang ? <p className="text-xs text-sale">{formatDiscount(it.line_discount_satang)}</p> : null}
                    <p className="font-medium tabular-nums text-ink">{formatBaht(it.line_total_satang)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-hairline-soft px-4 py-3 text-sm">
              <Line k="ราคาปกติรวม" v={formatBaht(o.totals.list_subtotal_satang)} muted />
              <Line k="ยอดสินค้า" v={formatBaht(o.totals.subtotal_satang)} />
              {/* layer 2 (buy-N-get-M) is already inside the line totals and layer 5 is the shipping discount below */}
              {o.adjustments.filter((a) => a.layer === 3 || a.layer === 4).map((a, i) => (
                <Line key={i} k={<>{a.label}{a.coupon_code ? <Badge tone="blue" className="ml-1 font-mono">{a.coupon_code}</Badge> : null}</>} v={formatDiscount(a.amount_satang)} sale />
              ))}
              <Line k="ค่าส่ง" v={formatBaht(o.totals.shipping_fee_satang)} />
              {o.totals.shipping_discount_satang ? <Line k={o.adjustments.find((a) => a.layer === 5)?.label ?? "ส่วนลดค่าส่ง"} v={formatDiscount(o.totals.shipping_discount_satang)} sale /> : null}
              <div className="flex justify-between border-t border-hairline-soft pt-2 text-base font-semibold">
                <dt>ยอดชำระ</dt>
                <dd className="tabular-nums">{formatBaht(o.totals.grand_total_satang)}</dd>
              </div>
              {o.totals.savings_satang ? <p className="text-right text-xs text-sale">ลูกค้าประหยัด {formatBaht(o.totals.savings_satang)}</p> : null}
            </dl>
          </Card>

          <Card title="ไทม์ไลน์">
            <ol className="relative ml-2 border-l border-hairline-soft">
              {[...history].reverse().map((h, i) => (
                <li key={i} className="relative pb-4 pl-5 last:pb-0">
                  <span className={`absolute -left-[7px] top-1 flex size-3.5 items-center justify-center rounded-full ${i === 0 ? "bg-accent" : "bg-hairline"}`}>
                    {i === 0 ? <span className="size-1.5 rounded-full bg-white" /> : null}
                  </span>
                  <p className="text-sm font-medium text-ink">
                    {h.from_status ? `${ORDER_STATUS_LABEL[h.from_status]} → ` : ""}
                    {ORDER_STATUS_LABEL[h.to_status]}
                  </p>
                  <p className="text-xs text-ink-2">
                    {fmtDateTime(h.created_at)} · {h.actor_email ?? "ระบบ"}
                    {h.note ? ` · ${h.note}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="ลูกค้า">
            {o.customer && can("customers:read") ? (
              <Link href={`/admin/customers/${o.customer.id}`} className="font-medium text-link hover:underline">
                {o.customer.name}
              </Link>
            ) : o.customer ? (
              <p className="font-medium text-ink">{o.customer.name}</p>
            ) : null}
            <p className="text-sm text-ink-2">{o.email}</p>
            {o.customer_note ? <p className="mt-2 rounded-[8px] bg-sale-soft px-2 py-1.5 text-[13px] text-ink">หมายเหตุ: {o.customer_note}</p> : null}
          </Card>
          <Card title="ที่อยู่จัดส่ง">
            <address className="text-sm not-italic leading-relaxed text-ink">
              <b>{addr.recipient_name}</b> · {addr.phone}
              <br />
              {addr.line1} {addr.line2}
              <br />
              {addr.subdistrict} {addr.district}
              <br />
              {addr.province} {addr.postal_code}
            </address>
          </Card>
          <Card title="การชำระเงิน">
            <div className="flex items-center justify-between text-sm">
              <span>{o.payment_method === "promptpay" ? "PromptPay" : "บัตรเครดิต/เดบิต"}</span>
              {o.payment ? (
                <Badge tone={o.payment.status === "successful" ? "green" : o.payment.status === "refunded" ? "red" : "orange"}>
                  {o.payment.status === "successful" ? "สำเร็จ" : o.payment.status === "refunded" ? "คืนเงินแล้ว" : o.payment.status === "pending" ? "รอชำระ" : o.payment.status}
                </Badge>
              ) : (
                <Badge>ไม่มีรายการ</Badge>
              )}
            </div>
            {o.payment ? <p className="mt-1 font-mono text-xs text-ink-2">{o.payment.charge_id}</p> : null}
            {o.paid_at ? <p className="text-xs text-ink-2">ชำระเมื่อ {fmtDateTime(o.paid_at)}</p> : o.status === "pending_payment" ? <p className="text-xs text-warning">ครบกำหนด {fmtDateTime(o.payment_due_at)}</p> : null}
          </Card>
          <Card title="การจัดส่ง">
            {o.shipment ? (
              <div className="text-sm">
                <p className="flex items-center gap-1.5 text-ink">
                  <Truck className="size-4 text-ink-2" aria-hidden /> {o.shipment.carrier === "flash_mock" ? "Flash Express (จำลอง)" : o.shipment.carrier}
                </p>
                <p className="mt-1 font-mono text-base font-semibold tracking-wide text-ink">{o.shipment.tracking_no}</p>
                <p className="text-xs text-ink-2">สถานะ: {TRACK_LABEL[o.shipment.status] ?? o.shipment.status}</p>
                {o.shipment.carrier === "flash_mock" && sid && advanceSupported && o.shipment.status !== "delivered" && can("orders:fulfil") ? (
                  <Button size="sm" variant="outline" className="mt-2" loading={busy} onClick={advance}>
                    เลื่อนสถานะพัสดุ (จำลอง)
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-ink-2">
                {o.status === "cancelled" || o.status === "refunded" ? <XCircle className="size-4" aria-hidden /> : o.status === "packing" ? <CircleDot className="size-4 text-link" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
                {o.status === "packing" ? "พร้อมสร้างใบส่ง" : o.status === "paid" ? "เริ่มแพ็คก่อนจึงสร้างใบส่งได้" : "ยังไม่มีการจัดส่ง"}
              </p>
            )}
          </Card>
        </div>
      </div>

      <Dialog
        open={Boolean(move)}
        onClose={() => setMove(null)}
        title={move === "cancelled" ? "ยกเลิกคำสั่งซื้อ?" : move === "refunded" ? "คืนเงินคำสั่งซื้อ?" : `เปลี่ยนเป็น “${move ? ORDER_STATUS_LABEL[move] : ""}”?`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setMove(null)}>ไม่ใช่ตอนนี้</Button>
            <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={doMove}>
              ยืนยัน
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-2">
          {move === "cancelled"
            ? o.status === "pending_payment"
              ? "คืนสต็อกและสิทธิ์โค้ดให้อัตโนมัติ"
              : `ลูกค้าชำระแล้ว ระบบจะคืนเงิน ${formatBaht(o.totals.grand_total_satang)} ผ่านผู้ให้บริการชำระเงิน การคืนเงินยกเลิกไม่ได้`
            : move === "refunded"
              ? `คืนเงิน ${formatBaht(o.totals.grand_total_satang)} ให้ลูกค้า — ทำแล้วยกเลิกไม่ได้`
              : "บันทึกในไทม์ไลน์พร้อมชื่อผู้ทำรายการ"}
        </p>
        <Field label="หมายเหตุ">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={danger ? "เหตุผล (แนะนำ)" : ""} />
        </Field>
      </Dialog>
    </div>
  );
}

function Line({ k, v, sale, muted }: { k: React.ReactNode; v: string; sale?: boolean; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{k}</dt>
      <dd className={`tabular-nums ${sale ? "text-sale" : muted ? "text-ink-2" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
