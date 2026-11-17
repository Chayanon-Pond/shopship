"use client";

import { ChevronDown, ScrollText } from "lucide-react";
import { useState } from "react";
import { listAuditLogs } from "@/lib/api/admin";
import { useApi, useUrlState } from "@/lib/admin/hooks";
import { fmtDateTime } from "@/lib/admin/format";
import { errorMessage } from "../overlay";
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, TableSkeleton } from "../ui";

const TARGETS = [
  ["", "ทุกประเภท"],
  ["order", "คำสั่งซื้อ"],
  ["product", "สินค้า"],
  ["variant", "ตัวเลือกสินค้า/สต็อก"],
  ["promotion", "โปรโมชัน"],
  ["coupon_code", "โค้ด"],
  ["flash_sale", "Flash Sale"],
  ["campaign", "แคมเปญ"],
  ["category", "หมวดหมู่"],
  ["banner", "แบนเนอร์"],
  ["user", "ผู้ใช้"],
  ["customer_group", "กลุ่มลูกค้า"],
  ["review", "รีวิว"],
] as const;

export function AuditPage() {
  const { values, set, page } = useUrlState(["action", "target_type", "from", "to"] as const);
  const [action, setAction] = useState(values.action);
  const query = { action: values.action || undefined, target_type: values.target_type || undefined, from: values.from || undefined, to: values.to || undefined, page, per_page: 25 };
  const res = useApi(() => listAuditLogs(query), JSON.stringify(query));
  const [open, setOpen] = useState<number | null>(null);
  const rows = res.data?.data ?? [];
  return (
    <div>
      <PageHeader title="บันทึกการใช้งาน" subtitle="ทุกการแก้ไขในหลังร้านถูกบันทึกพร้อมผู้ทำรายการ เวลา และ IP" />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft p-3">
          <form className="min-w-[180px] flex-1" onSubmit={(e) => (e.preventDefault(), set({ action }))}>
            <Input type="search" value={action} onChange={(e) => setAction(e.target.value)} onBlur={() => action !== values.action && set({ action })} placeholder="action เช่น order.status" className="font-mono" aria-label="action" />
          </form>
          <Select value={values.target_type} onChange={(e) => set({ target_type: e.target.value })} className="w-auto" aria-label="ประเภท">
            {TARGETS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Input type="date" value={values.from} onChange={(e) => set({ from: e.target.value })} className="w-auto" aria-label="ตั้งแต่" />
          <Input type="date" value={values.to} onChange={(e) => set({ to: e.target.value })} className="w-auto" aria-label="ถึง" />
        </div>
        {res.error ? (
          <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />
        ) : !res.data ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="ไม่มีบันทึก" />
        ) : (
          <>
            <ul className="divide-y divide-hairline-soft">
              {rows.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left text-sm hover:bg-surface-2">
                    <span className="w-32 shrink-0 text-xs tabular-nums text-ink-2">{fmtDateTime(a.created_at)}</span>
                    <code className="rounded bg-canvas-alt px-1.5 py-0.5 text-xs text-ink">{a.action}</code>
                    <Badge>
                      {TARGETS.find(([v]) => v === a.target_type)?.[1] ?? a.target_type} #{a.target_id}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{a.actor?.email ?? "ระบบ"}</span>
                    <span className="hidden text-xs text-ink-3 sm:block">{a.ip}</span>
                    <ChevronDown className={`size-4 text-ink-3 transition-transform ${open === a.id ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {open === a.id ? <pre className="mx-4 mb-3 overflow-x-auto rounded-[10px] bg-canvas-alt p-3 text-xs text-ink">{JSON.stringify(a.metadata, null, 2)}</pre> : null}
                </li>
              ))}
            </ul>
            <Pagination page={res.data.meta.page} totalPages={res.data.meta.total_pages} total={res.data.meta.total} onPage={(p) => set({ page: p }, false)} />
          </>
        )}
      </Card>
    </div>
  );
}
