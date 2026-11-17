"use client";

import { AlertTriangle, ArrowRight, CalendarRange, ClipboardList, PackageCheck, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatBaht } from "@/lib/money";
import { getDashboard, listCampaigns, listOrders } from "@/lib/api/admin";
import type { OrderStatus } from "@/lib/api/types";
import { useApi } from "@/lib/admin/hooks";
import { daysLeft, daysUntil, fmtDateTime, fmtInt, ORDER_STATUS_LABEL, windowStatus } from "@/lib/admin/format";
import { OrderStatusBadge } from "../bits";
import { useSession } from "../session";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, Sparkline, Stat } from "../ui";

const STATUS_COUNTS: OrderStatus[] = ["pending_payment", "paid", "packing", "shipped", "delivered", "completed"];

export function DashboardPage() {
  const { me, can } = useSession();
  const dash = useApi(getDashboard, "dash");
  const recent = useApi(() => listOrders({ per_page: 8 }), "recent", can("orders:read"));
  const counts = useApi(
    () => Promise.all(STATUS_COUNTS.map((s) => listOrders({ status: s, per_page: 1 }).then((r) => [s, r.meta.total] as const))),
    "counts",
    can("orders:read"),
  );
  const camps = useApi(() => listCampaigns(), "camps", can("promotions:read"));
  const d = dash.data;
  const [now] = useState(() => Date.now());
  const hour = (new Date(now).getUTCHours() + 7) % 24;
  const greeting = hour < 12 ? "อรุณสวัสดิ์" : hour < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";
  const activeCamps = (camps.data?.data ?? []).filter((c) => c.is_active && windowStatus(c.starts_at, c.ends_at, now) !== "expired").slice(0, 4);
  const maxCount = Math.max(1, ...(counts.data ?? []).map(([, n]) => n));

  return (
    <div>
      <PageHeader title={`${greeting}, ${me.name || "ทีมงาน"}`} subtitle="ภาพรวมร้านวันนี้ (เวลาไทย)" />
      {dash.error ? <ErrorState message="โหลดแดชบอร์ดไม่สำเร็จ" onRetry={dash.reload} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {!d ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[132px] rounded-[12px]" />)
        ) : (
          <>
            <Stat label="ยอดขายวันนี้" icon={Wallet} value={formatBaht(d.today.sales_satang, { decimals: "never" })} sub={`${fmtInt(d.today.paid_orders)} ออเดอร์ที่ชำระแล้ว จาก ${fmtInt(d.today.orders)}`}>
              <Sparkline values={d.sales_7d.map((x) => x.sales_satang)} className="mt-3" height={36} />
            </Stat>
            <Stat label="ยอดขายเดือนนี้" icon={TrendingUp} value={formatBaht(d.month.sales_satang, { decimals: "never" })} sub={`${fmtInt(d.month.orders)} ออเดอร์`}>
              <div className="mt-3 flex items-end gap-1" aria-label="ยอดขาย 7 วันล่าสุด">
                {d.sales_7d.map((x) => {
                  const max = Math.max(1, ...d.sales_7d.map((y) => y.sales_satang));
                  return <div key={x.date} title={`${x.date}: ${formatBaht(x.sales_satang)}`} className="flex-1 rounded-[3px] bg-accent/80" style={{ height: `${Math.max(4, (x.sales_satang / max) * 36)}px` }} />;
                })}
              </div>
            </Stat>
            <Link href="/admin/packing" className="block rounded-[12px] transition-transform hover:-translate-y-0.5">
              <Stat label="รอแพ็ค/จัดส่ง" icon={PackageCheck} value={fmtInt(d.pending.to_pack)} sub="ชำระแล้ว + กำลังแพ็ค">
                <span className="mt-3 inline-flex items-center gap-1 text-[13px] text-link">
                  ไปหน้าแพ็คของ <ArrowRight className="size-3.5" aria-hidden />
                </span>
              </Stat>
            </Link>
            <Link href="/admin/orders?status=pending_payment" className="block rounded-[12px] transition-transform hover:-translate-y-0.5">
              <Stat label="รอชำระเงิน" icon={ClipboardList} value={fmtInt(d.pending.pending_payment)} sub="ระบบยกเลิกอัตโนมัติเมื่อครบ 15 นาที">
                <span className="mt-3 inline-flex items-center gap-1 text-[13px] text-link">
                  ดูรายการ <ArrowRight className="size-3.5" aria-hidden />
                </span>
              </Stat>
            </Link>
          </>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="คำสั่งซื้อตามสถานะ" className="lg:col-span-1">
          {!counts.data ? (
            <div className="space-y-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : (
            <ul className="space-y-2.5">
              {counts.data.map(([s, n]) => (
                <li key={s}>
                  <Link href={`/admin/orders?status=${s}`} className="group flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-ink-2 group-hover:text-ink">{ORDER_STATUS_LABEL[s]}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-canvas-alt">
                      <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(n / maxCount) * 100}%` }} />
                    </span>
                    <span className="w-8 text-right tabular-nums font-medium text-ink">{n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="แคมเปญที่กำลังจัด / ใกล้ถึง" actions={<Link href="/admin/promotions?tab=campaigns" className="text-[13px] text-link hover:underline">ทั้งหมด</Link>} className="lg:col-span-1">
          {!camps.data ? (
            <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : activeCamps.length === 0 ? (
            <EmptyState icon={CalendarRange} title="ยังไม่มีแคมเปญ" />
          ) : (
            <ul className="space-y-2">
              {activeCamps.map((c) => {
                const st = windowStatus(c.starts_at, c.ends_at, now);
                const total = Date.parse(c.ends_at) - Date.parse(c.starts_at);
                const pct = st === "active" ? Math.min(100, ((now - Date.parse(c.starts_at)) / total) * 100) : 0;
                return (
                  <li key={c.id} className="rounded-[10px] border border-hairline-soft p-3">
                    <div className="flex items-center gap-2">
                      <span className="size-3 rounded-full" style={{ background: c.theme.accent }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{c.name}</span>
                      <span className={st === "active" ? "text-xs font-medium text-success" : "text-xs text-link"}>
                        {st === "active" ? `เหลือ ${daysLeft(c.ends_at, now)} วัน` : `อีก ${daysUntil(c.starts_at, now)} วัน`}
                      </span>
                    </div>
                    {st === "active" ? (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-canvas-alt">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.theme.accent }} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="สินค้าใกล้หมด" actions={<Link href="/admin/inventory?low_stock=1" className="text-[13px] text-link hover:underline">จัดการสต็อก</Link>}>
          {!d ? (
            <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : d.low_stock.length === 0 ? (
            <EmptyState title="สต็อกเพียงพอทุกรายการ" />
          ) : (
            <ul className="divide-y divide-hairline-soft">
              {d.low_stock.map((x) => (
                <li key={x.variant_id} className="flex items-center gap-2 py-2 text-sm">
                  <AlertTriangle className={x.stock === 0 ? "size-4 text-danger" : "size-4 text-warning"} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{x.product_name}</span>
                    <span className="text-xs text-ink-2">{x.sku}</span>
                  </span>
                  <span className={x.stock === 0 ? "font-medium text-danger" : "font-medium text-warning"}>{x.stock === 0 ? "หมด" : `เหลือ ${x.stock}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="คำสั่งซื้อล่าสุด" pad={false} className="lg:col-span-2" actions={<Link href="/admin/orders" className="text-[13px] text-link hover:underline">ดูทั้งหมด</Link>}>
          {!recent.data ? (
            <div className="space-y-3 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
          ) : recent.data.data.length === 0 ? (
            <EmptyState title="ยังไม่มีคำสั่งซื้อ" />
          ) : (
            <ul className="divide-y divide-hairline-soft">
              {recent.data.data.map((o) => (
                <li key={o.order_no}>
                  <Link href={`/admin/orders/${o.order_no}`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                    <span className="w-32 shrink-0 font-medium tabular-nums text-ink">{o.order_no}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-ink-2 sm:block">{o.customer.name}</span>
                    <span className="hidden w-28 text-xs text-ink-2 md:block">{fmtDateTime(o.created_at)}</span>
                    <OrderStatusBadge status={o.status} />
                    <span className="ml-auto w-24 text-right font-medium tabular-nums text-ink">{formatBaht(o.grand_total_satang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="สินค้าขายดีเดือนนี้">
          {!d ? (
            <div className="space-y-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : d.top_products.length === 0 ? (
            <EmptyState title="ยังไม่มียอดขาย" />
          ) : (
            <ol className="space-y-3">
              {d.top_products.map((p, i) => (
                <li key={p.product_id} className="flex items-center gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas-alt text-xs font-semibold text-ink-2">{i + 1}</span>
                  <Link href={`/admin/products/${p.product_id}`} className="min-w-0 flex-1 truncate text-ink hover:text-link">
                    {p.name}
                  </Link>
                  <span className="text-xs text-ink-2">{p.qty} ชิ้น</span>
                  <span className="w-20 text-right font-medium tabular-nums">{formatBaht(p.sales_satang, { decimals: "never" })}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
