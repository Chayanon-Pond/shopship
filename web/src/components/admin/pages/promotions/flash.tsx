"use client";

import { Plus, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatBaht } from "@/lib/money";
import { listFlashSales } from "@/lib/api/admin";
import { useApi } from "@/lib/admin/hooks";
import { fmtDateTime, windowStatus } from "@/lib/admin/format";
import { WindowBadge } from "../../bits";
import { errorMessage } from "../../overlay";
import { useSession } from "../../session";
import { Badge, Card, EmptyState, ErrorState, LinkButton, Progress, Skeleton } from "../../ui";

export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
export function countdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return d > 0 ? `${d} วัน ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

export function FlashTab() {
  const { can } = useSession();
  const res = useApi(() => listFlashSales({ per_page: 100 }), "flash");
  const now = useNow(1000);
  const { reload } = res;
  // live sold progress: refresh every 15 s
  useEffect(() => {
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload]);
  if (res.error) return <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />;
  const rows = [...(res.data?.data ?? [])].filter((f) => f.status !== "archived").sort((a, b) => {
    const rank = (x: typeof a) => ({ active: 0, upcoming: 1, expired: 2 })[windowStatus(x.starts_at, x.ends_at, now)];
    return rank(a) - rank(b) || Date.parse(a.starts_at) - Date.parse(b.starts_at);
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-ink-2">ราคา Flash ใช้แทนราคาปกติเมื่อยังมีโควตา ไม่ซ้อนกับโปรซื้อ N แถม M · อัปเดตยอดขายทุก 15 วินาที</p>
        {can("promotions:write") ? (
          <LinkButton href="/admin/flash-sales/new" variant="primary" icon={Plus} className="ml-auto">
            สร้าง Flash Sale
          </LinkButton>
        ) : null}
      </div>
      {!res.data ? (
        <Skeleton className="h-64 rounded-[12px]" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Zap} title="ยังไม่มี Flash Sale" />
        </Card>
      ) : (
        rows.map((f) => {
          const st = windowStatus(f.starts_at, f.ends_at, now);
          const sold = f.items.reduce((s, i) => s + i.sold_qty, 0);
          const limit = f.items.reduce((s, i) => s + i.qty_limit, 0);
          return (
            <Card
              key={f.id}
              pad={false}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Zap className="size-4 text-sale" aria-hidden />
                  <Link href={`/admin/flash-sales/${f.id}`} className="hover:text-link">
                    {f.name}
                  </Link>
                  <WindowBadge status={st} />
                  {f.status !== "active" ? <Badge>{f.status === "draft" ? "ร่าง" : "หยุด"}</Badge> : null}
                </span>
              }
              actions={
                <span className="text-right text-[13px] text-ink-2">
                  {st === "active" ? (
                    <>
                      จบใน <span className="font-mono font-semibold text-sale">{countdown(Date.parse(f.ends_at) - now)}</span>
                    </>
                  ) : st === "upcoming" ? (
                    <>
                      เริ่มใน <span className="font-mono font-semibold text-link">{countdown(Date.parse(f.starts_at) - now)}</span>
                    </>
                  ) : (
                    `${fmtDateTime(f.starts_at)} – ${fmtDateTime(f.ends_at)}`
                  )}
                </span>
              }
            >
              <div className="flex items-center gap-3 border-b border-hairline-soft px-4 py-2 text-[13px]">
                <span className="text-ink-2">ขายแล้ว</span>
                <Progress value={sold} max={limit} tone="orange" className="max-w-xs" label="ยอดขายรวม" />
                <span className="font-medium tabular-nums">
                  {sold}/{limit}
                </span>
              </div>
              <ul className="divide-y divide-hairline-soft">
                {f.items.map((i) => (
                  <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_160px_200px]">
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{i.product_name}</span>
                      <span className="text-xs text-ink-2">
                        {i.variant_name} · <span className="font-mono">{i.sku}</span>
                        {i.per_customer_limit ? ` · คนละ ${i.per_customer_limit}` : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="font-semibold text-sale">{formatBaht(i.sale_price_satang)}</span> <span className="price-strike text-xs">{formatBaht(i.list_price_satang)}</span>
                    </span>
                    <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <Progress value={i.sold_qty} max={i.qty_limit} tone={i.sold_qty >= i.qty_limit ? "green" : "orange"} label={`ขายแล้ว ${i.sold_qty} จาก ${i.qty_limit}`} />
                      <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-2">{i.sold_qty >= i.qty_limit ? "หมดแล้ว" : `${i.sold_qty}/${i.qty_limit}`}</span>
                    </span>
                  </li>
                ))}
                {f.items.length === 0 ? <li className="px-4 py-4 text-sm text-ink-2">ยังไม่มีสินค้า</li> : null}
              </ul>
            </Card>
          );
        })
      )}
    </div>
  );
}
