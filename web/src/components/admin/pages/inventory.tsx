"use client";

import { Boxes, Minus, Plus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { adjustInventory, listInventory, type InventoryRow } from "@/lib/api/admin";
import { useApi, useUrlState } from "@/lib/admin/hooks";
import { adjustSchema, validate } from "@/lib/admin/schemas";
import { IntInput, StockBadge } from "../bits";
import { Dialog, errorMessage, useToast } from "../overlay";
import { useSession } from "../session";
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, Pagination, Segmented, Select, Table, TableSkeleton, Td, Th } from "../ui";

const REASONS = ["รับสินค้าเข้า", "นับสต็อกใหม่", "สินค้าชำรุด/เสียหาย", "สินค้าสูญหาย", "ลูกค้าคืนสินค้า", "ใช้ภายใน/ตัวอย่าง"];

export function InventoryPage() {
  const { can } = useSession();
  const { values, set, page } = useUrlState(["q", "low_stock"] as const);
  const [q, setQ] = useState(values.q);
  const query = { q: values.q || undefined, low_stock: values.low_stock ? true : undefined, page, per_page: 50 };
  const res = useApi(() => listInventory(query), JSON.stringify(query));
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);
  const rows = res.data?.data ?? [];
  return (
    <div>
      <PageHeader title="สต็อก" subtitle="ปรับสต็อกทุกครั้งต้องระบุเหตุผล (บันทึกในประวัติการใช้งาน)" />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft p-3">
          <form className="relative min-w-[200px] flex-1" onSubmit={(e) => (e.preventDefault(), set({ q }))}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q !== values.q && set({ q })} placeholder="ค้นหาสินค้าหรือ SKU" className="pl-9" aria-label="ค้นหา" />
          </form>
          <Checkbox checked={Boolean(values.low_stock)} onChange={(v) => set({ low_stock: v ? "1" : null })} label="เฉพาะใกล้หมด" />
        </div>
        {res.error ? (
          <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />
        ) : !res.data ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={Boxes} title="ไม่พบรายการ" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>สินค้า</Th>
                  <Th>SKU</Th>
                  <Th align="right">คงเหลือ</Th>
                  <Th align="right">จองอยู่</Th>
                  <Th align="right">พร้อมขาย</Th>
                  <Th align="right">แจ้งเตือนเมื่อ ≤</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.variant_id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/admin/products/${r.product_id}`} className="font-medium text-ink hover:text-link">
                        {r.product_name}
                      </Link>
                      <span className="block text-xs text-ink-2">{r.variant_name}</span>
                    </Td>
                    <Td className="font-mono text-[13px] text-ink-2">{r.sku}</Td>
                    <Td align="right">
                      <StockBadge stock={r.stock} threshold={r.low_stock_threshold} />
                    </Td>
                    <Td align="right" className="text-ink-2">{r.reserved_qty}</Td>
                    <Td align="right">{Math.max(0, r.stock - r.reserved_qty)}</Td>
                    <Td align="right" className="text-ink-2">{r.low_stock_threshold}</Td>
                    <Td align="right">
                      {can("inventory:write") ? (
                        <Button size="sm" variant="outline" icon={SlidersHorizontal} onClick={() => setAdjusting(r)}>
                          ปรับ
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={res.data.meta.page} totalPages={res.data.meta.total_pages} total={res.data.meta.total} onPage={(p) => set({ page: p }, false)} />
          </>
        )}
      </Card>
      {adjusting ? (
        <AdjustDialog
          row={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={(stock) => {
            res.mutate((d) => (d ? { ...d, data: d.data.map((x) => (x.variant_id === adjusting.variant_id ? { ...x, stock } : x)) } : d!));
            setAdjusting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AdjustDialog({ row, onClose, onDone }: { row: InventoryRow; onClose: () => void; onDone: (stock: number) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const n = Number(qty || 0);
  const delta = mode === "add" ? n : mode === "remove" ? -n : n - row.stock;
  const after = row.stock + delta;
  async function save() {
    const fullReason = note.trim() ? `${reason}: ${note.trim()}` : reason;
    const v = validate(adjustSchema, { delta: String(delta), reason: fullReason });
    if (!qty) return setErrors({ delta: "กรุณากรอกจำนวน" });
    if (!v.ok) return setErrors(v.errors);
    if (after < 0) return setErrors({ delta: `สต็อกติดลบไม่ได้ (คงเหลือ ${row.stock})` });
    setBusy(true);
    try {
      const r = await adjustInventory(row.variant_id, delta, fullReason);
      toast(`ปรับสต็อก ${row.sku} เป็น ${r.stock} แล้ว`);
      onDone(r.stock);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={`ปรับสต็อก ${row.sku}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!qty || delta === 0}>
            บันทึก
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">
        {row.product_name} · {row.variant_name}
      </p>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "add", label: <span className="inline-flex items-center gap-1"><Plus className="size-3.5" />รับเข้า</span> },
          { value: "remove", label: <span className="inline-flex items-center gap-1"><Minus className="size-3.5" />ตัดออก</span> },
          { value: "set", label: "ตั้งค่าใหม่" },
        ]}
        className="mb-4 w-full [&>button]:flex-1"
      />
      <div className="grid gap-4">
        <Field label={mode === "set" ? "จำนวนที่นับได้" : "จำนวน"} error={errors.delta}>
          <IntInput value={qty} onChange={setQty} invalid={Boolean(errors.delta)} autoFocus className="h-12 text-lg" />
        </Field>
        <div className="flex items-center justify-between rounded-[10px] bg-canvas-alt px-3 py-2 text-sm">
          <span className="text-ink-2">คงเหลือ {row.stock}</span>
          <span className={delta < 0 ? "text-danger" : "text-success"}>{delta > 0 ? `+${delta}` : delta}</span>
          <span className={after < 0 ? "font-semibold text-danger" : "font-semibold text-ink"}>หลังปรับ {after}</span>
        </div>
        <Field label="เหตุผล" required error={errors.reason}>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="หมายเหตุเพิ่มเติม">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น เลขที่ใบรับของ" />
        </Field>
      </div>
    </Dialog>
  );
}
