"use client";

import { ClipboardList, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatBaht } from "@/lib/money";
import { listOrders } from "@/lib/api/admin";
import type { OrderStatus } from "@/lib/api/types";
import { useApi, useUrlState } from "@/lib/admin/hooks";
import { fmtDateTime, ORDER_STATUS_LABEL, ORDER_STATUS_ORDER } from "@/lib/admin/format";
import { OrderStatusBadge } from "../bits";
import { errorMessage } from "../overlay";
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Table, TableSkeleton, Td, Th } from "../ui";

const KEYS = ["q", "status", "from", "to", "payment_method"] as const;

export function OrdersPage() {
  const { values, set, page } = useUrlState(KEYS);
  const [q, setQ] = useState(values.q);
  const query = { q: values.q || undefined, status: (values.status || undefined) as OrderStatus | undefined, from: values.from || undefined, to: values.to || undefined, payment_method: values.payment_method || undefined, page, per_page: 20 };
  const res = useApi(() => listOrders(query), JSON.stringify(query));
  const rows = res.data?.data ?? [];
  const chips: (OrderStatus | "")[] = ["", "pending_payment", "paid", "packing", "shipped", "delivered", "completed", "cancelled", "refunded"];
  return (
    <div>
      <PageHeader title="คำสั่งซื้อ" subtitle={res.data ? `${res.data.meta.total.toLocaleString("th-TH")} รายการ` : " "} />
      <div className="no-scrollbar -mx-3 mb-3 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {chips.map((s) => (
          <button
            key={s || "all"}
            type="button"
            onClick={() => set({ status: s })}
            className={`h-8 shrink-0 rounded-full px-3 text-[13px] transition-colors ${values.status === s ? "bg-ink text-white" : "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--hairline-soft)] hover:bg-canvas-alt"}`}
          >
            {s ? ORDER_STATUS_LABEL[s] : "ทั้งหมด"}
          </button>
        ))}
      </div>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft p-3">
          <form className="relative min-w-[200px] flex-1" onSubmit={(e) => (e.preventDefault(), set({ q }))}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q !== values.q && set({ q })} placeholder="เลขคำสั่งซื้อ อีเมล หรือเบอร์โทร" className="pl-9" aria-label="ค้นหาคำสั่งซื้อ" />
          </form>
          <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="w-auto min-w-[130px] md:hidden" aria-label="สถานะ">
            <option value="">ทุกสถานะ</option>
            {ORDER_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
            จาก
            <Input type="date" value={values.from} onChange={(e) => set({ from: e.target.value })} className="w-auto" aria-label="ตั้งแต่วันที่" />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
            ถึง
            <Input type="date" value={values.to} onChange={(e) => set({ to: e.target.value })} className="w-auto" aria-label="ถึงวันที่" />
          </label>
          <Select value={values.payment_method} onChange={(e) => set({ payment_method: e.target.value })} className="w-auto min-w-[130px]" aria-label="วิธีชำระเงิน">
            <option value="">ทุกการชำระ</option>
            <option value="promptpay">PromptPay</option>
            <option value="card">บัตร</option>
          </Select>
        </div>
        {res.error ? (
          <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />
        ) : !res.data ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title="ไม่พบคำสั่งซื้อ" body="ลองเปลี่ยนตัวกรองหรือช่วงวันที่" />
        ) : (
          <div className={res.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <Table>
              <thead>
                <tr>
                  <Th>เลขที่</Th>
                  <Th>ลูกค้า</Th>
                  <Th>วันที่</Th>
                  <Th>สถานะ</Th>
                  <Th>ชำระ</Th>
                  <Th align="right">ชิ้น</Th>
                  <Th align="right">ยอดรวม</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.order_no} className="cursor-pointer hover:bg-surface-2">
                    <Td>
                      <Link href={`/admin/orders/${o.order_no}`} className="font-medium tabular-nums text-ink hover:text-link">
                        {o.order_no}
                      </Link>
                    </Td>
                    <Td>
                      <span className="block text-ink">{o.customer.name}</span>
                      <span className="text-xs text-ink-2">{o.customer.email}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{fmtDateTime(o.created_at)}</Td>
                    <Td>
                      <OrderStatusBadge status={o.status} />
                    </Td>
                    <Td>
                      <Badge>{o.payment_method === "promptpay" ? "PromptPay" : "บัตร"}</Badge>
                    </Td>
                    <Td align="right">{o.item_count}</Td>
                    <Td align="right" className="font-medium">
                      {formatBaht(o.grand_total_satang)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={res.data.meta.page} totalPages={res.data.meta.total_pages} total={res.data.meta.total} onPage={(p) => set({ page: p }, false)} />
          </div>
        )}
      </Card>
    </div>
  );
}
