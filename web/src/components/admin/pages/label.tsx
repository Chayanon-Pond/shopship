"use client";

import { Printer } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { USE_MOCKS } from "@/lib/api/client";
import { useEffect, useState } from "react";
import { getAdminMe, getOrder, type AdminOrder } from "@/lib/api/admin";
import { errorMessage } from "../overlay";
import { fmtDateTime } from "@/lib/admin/format";

/** Code-128-looking stripes derived from the tracking number (placeholder, not scannable). */
function Stripes({ value }: { value: string }) {
  const bars: number[] = [];
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    bars.push((c % 3) + 1, ((c >> 2) % 2) + 1, ((c >> 3) % 3) + 1, 1);
  }
  let x = 0;
  return (
    <svg viewBox={`0 0 ${bars.reduce((s, b) => s + b, 0)} 40`} preserveAspectRatio="none" className="h-16 w-full" aria-hidden>
      {bars.map((w, i) => {
        const r = i % 2 === 0 ? <rect key={i} x={x} y={0} width={w} height={40} fill="#000" /> : null;
        x += w;
        return r;
      })}
    </svg>
  );
}

export function ShippingLabel() {
  const { orderNo } = useParams<{ orderNo: string }>();
  const tracking = useSearchParams().get("tracking");
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    getAdminMe()
      .then(() => getOrder(decodeURIComponent(orderNo)))
      .then(
        // mock state is per page load: a label opened in a new tab keeps the tracking number from the URL
        (o) => alive && setOrder(!o.shipment && USE_MOCKS && tracking ? { ...o, shipment: { carrier: "flash_mock", tracking_no: tracking, status: "created" } } : o),
        (e) => alive && setError(errorMessage(e)),
      );
    return () => {
      alive = false;
    };
  }, [orderNo, tracking]);
  useEffect(() => {
    if (order?.shipment) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [order]);
  if (error) return <p className="p-8 text-center text-danger">{error}</p>;
  if (!order) return <p className="p-8 text-center text-ink-2">กำลังเตรียมใบปะหน้า…</p>;
  if (!order.shipment) return <p className="p-8 text-center text-ink-2">คำสั่งซื้อนี้ยังไม่มีใบส่ง</p>;
  const a = order.shipping_address;
  return (
    <div className="flex min-h-dvh flex-col items-center gap-4 bg-canvas-alt p-6 print:bg-white print:p-0">
      <style>{`@page{size:100mm 150mm;margin:0}@media print{.no-print{display:none!important}body{background:#fff}}`}</style>
      <button type="button" onClick={() => window.print()} className="no-print inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 font-medium text-white">
        <Printer className="size-5" aria-hidden /> พิมพ์ / บันทึกเป็น PDF
      </button>
      <article className="flex h-[150mm] w-[100mm] flex-col border-2 border-black bg-white p-[5mm] text-[11pt] leading-snug text-black print:border-0">
        <header className="flex items-center justify-between border-b-2 border-black pb-2">
          <span className="text-[14pt] font-bold">FLASH EXPRESS</span>
          <span className="rounded border border-black px-1.5 text-[9pt] font-semibold">MOCK · ทดสอบ</span>
        </header>
        <div className="py-2 text-center">
          <Stripes value={order.shipment.tracking_no} />
          <p className="mt-1 font-mono text-[14pt] font-bold tracking-widest">{order.shipment.tracking_no}</p>
        </div>
        <section className="border-t-2 border-black py-2">
          <p className="text-[9pt] font-semibold">ผู้รับ</p>
          <p className="text-[13pt] font-bold">{a.recipient_name}</p>
          <p>{a.phone}</p>
          <p>
            {a.line1} {a.line2}
          </p>
          <p>
            {a.subdistrict} {a.district} {a.province}
          </p>
          <p className="mt-1 text-[20pt] font-bold tracking-[0.3em]">{a.postal_code}</p>
        </section>
        <section className="border-t border-dashed border-black py-2 text-[9pt]">
          <p className="font-semibold">ผู้ส่ง</p>
          <p>ShopShip · 99 ถ.สุขุมวิท กรุงเทพฯ 10110 · 02-000-0000</p>
        </section>
        <footer className="mt-auto flex items-end justify-between border-t-2 border-black pt-2 text-[9pt]">
          <span>
            ออเดอร์ <b className="font-mono">{order.order_no}</b>
            <br />
            {order.items.reduce((s, i) => s + i.qty, 0)} ชิ้น · {fmtDateTime(order.paid_at ?? order.created_at)}
          </span>
          <span className="text-[16pt] font-bold">{order.payment_method === "promptpay" ? "PAID" : "PAID"}</span>
        </footer>
      </article>
    </div>
  );
}
