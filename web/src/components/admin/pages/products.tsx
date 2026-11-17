"use client";

import { Eye, EyeOff, FileSpreadsheet, Package, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { listCategories, listProducts, updateProduct } from "@/lib/api/admin";
import { useApi, useUrlState } from "@/lib/admin/hooks";
import { fmtDate, priceRange } from "@/lib/admin/format";
import { ProductStatusBadge, StockBadge } from "../bits";
import { errorMessage, useConfirm, useToast } from "../overlay";
import { useSession } from "../session";
import { Button, Card, Checkbox, EmptyState, ErrorState, Input, LinkButton, PageHeader, Pagination, Select, Table, TableSkeleton, Td, Th } from "../ui";

const KEYS = ["q", "status", "category_id", "low_stock"] as const;

export function ProductsPage() {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { values, set, page } = useUrlState(KEYS);
  const [q, setQ] = useState(values.q);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const query = { q: values.q || undefined, status: values.status || undefined, category_id: values.category_id ? Number(values.category_id) : undefined, low_stock: values.low_stock ? true : undefined, page, per_page: 20 };
  const res = useApi(() => listProducts(query), JSON.stringify(query));
  const cats = useApi(listCategories, "cats");
  const rows = res.data?.data ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const canWrite = can("catalog:write");

  async function bulk(status: "active" | "hidden") {
    const ids = [...selected];
    const ok = await confirm({
      title: status === "active" ? `เผยแพร่ ${ids.length} สินค้า?` : `ซ่อน ${ids.length} สินค้า?`,
      body: status === "active" ? "สินค้าจะแสดงบนหน้าร้านทันที" : "ลูกค้าจะไม่เห็นสินค้าเหล่านี้บนหน้าร้าน (ข้อมูลไม่ถูกลบ)",
      confirmLabel: status === "active" ? "เผยแพร่" : "ซ่อน",
      danger: status === "hidden",
    });
    if (!ok) return;
    setBusy(true);
    const results = await Promise.allSettled(ids.map((id) => updateProduct(id, { status })));
    setBusy(false);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) toast(`ทำรายการไม่สำเร็จ ${failed.length} รายการ: ${errorMessage((failed[0] as PromiseRejectedResult).reason)}`, "error");
    else toast(status === "active" ? `เผยแพร่ ${ids.length} สินค้าแล้ว` : `ซ่อน ${ids.length} สินค้าแล้ว`);
    setSelected(new Set());
    res.reload();
  }

  const parents = (cats.data?.data ?? []).filter((c) => c.parent_id === null);
  return (
    <div>
      <PageHeader
        title="สินค้า"
        subtitle={res.data ? `${res.data.meta.total.toLocaleString("th-TH")} รายการ` : " "}
        actions={
          <>
            <LinkButton href="/admin/products/import" icon={FileSpreadsheet}>นำเข้า/ส่งออก CSV</LinkButton>
            {canWrite ? <LinkButton href="/admin/products/new" variant="primary" icon={Plus}>เพิ่มสินค้า</LinkButton> : null}
          </>
        }
      />
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft p-3">
          <form
            className="relative min-w-[200px] flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q });
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q !== values.q && set({ q })} placeholder="ค้นหาชื่อ (ไทย/อังกฤษ) หรือ SKU" className="pl-9" aria-label="ค้นหาสินค้า" />
          </form>
          <Select value={values.status} onChange={(e) => set({ status: e.target.value })} className="w-auto min-w-[130px]" aria-label="สถานะ">
            <option value="">ทุกสถานะ</option>
            <option value="active">เผยแพร่</option>
            <option value="hidden">ซ่อน</option>
            <option value="draft">ฉบับร่าง</option>
            <option value="archived">เก็บถาวร</option>
          </Select>
          <Select value={values.category_id} onChange={(e) => set({ category_id: e.target.value })} className="w-auto min-w-[150px]" aria-label="หมวดหมู่">
            <option value="">ทุกหมวดหมู่</option>
            {parents.map((p) => (
              <optgroup key={p.id} label={p.name}>
                <option value={p.id}>{p.name} (ทั้งหมด)</option>
                {(cats.data?.data ?? [])
                  .filter((c) => c.parent_id === p.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
          <Checkbox checked={Boolean(values.low_stock)} onChange={(v) => set({ low_stock: v ? "1" : null })} label="ใกล้หมด" className="px-1" />
        </div>

        {selected.size > 0 && canWrite ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft bg-accent-soft/60 px-4 py-2 text-sm">
            <span className="font-medium text-ink">เลือก {selected.size} รายการ</span>
            <Button size="sm" variant="outline" icon={Eye} loading={busy} onClick={() => bulk("active")}>
              เผยแพร่
            </Button>
            <Button size="sm" variant="outline" icon={EyeOff} loading={busy} onClick={() => bulk("hidden")}>
              ซ่อน
            </Button>
            <button type="button" className="ml-auto text-[13px] text-link" onClick={() => setSelected(new Set())}>
              ล้างการเลือก
            </button>
          </div>
        ) : null}

        {res.error ? (
          <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />
        ) : !res.data ? (
          <TableSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState icon={Package} title="ไม่พบสินค้า" body={values.q ? `ไม่มีสินค้าที่ตรงกับ “${values.q}”` : "เริ่มเพิ่มสินค้าชิ้นแรกของร้าน"} action={canWrite ? <LinkButton href="/admin/products/new" variant="primary" icon={Plus}>เพิ่มสินค้า</LinkButton> : null} />
        ) : (
          <div className={res.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <Table>
              <thead>
                <tr>
                  {canWrite ? (
                    <Th className="w-10">
                      <Checkbox checked={allChecked} indeterminate={!allChecked && rows.some((r) => selected.has(r.id))} onChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} />
                    </Th>
                  ) : null}
                  <Th>สินค้า</Th>
                  <Th>หมวดหมู่</Th>
                  <Th>สถานะ</Th>
                  <Th align="right">ราคา</Th>
                  <Th align="right">สต็อก</Th>
                  <Th>อัปเดต</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2">
                    {canWrite ? (
                      <Td>
                        <Checkbox
                          checked={selected.has(p.id)}
                          onChange={(v) =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (v) n.add(p.id);
                              else n.delete(p.id);
                              return n;
                            })
                          }
                        />
                      </Td>
                    ) : null}
                    <Td>
                      <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.image_url || "/mock/canvas-tote.svg"} alt="" className="size-11 shrink-0 rounded-[8px] border border-hairline-soft bg-canvas-alt object-cover" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink hover:text-link">{p.name}</span>
                          <span className="block truncate text-xs text-ink-2">
                            {p.name_en ? `${p.name_en} · ` : ""}
                            {p.variant_count} ตัวเลือก
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td className="text-ink-2">{p.category.name}</Td>
                    <Td>
                      <ProductStatusBadge status={p.status} />
                    </Td>
                    <Td align="right">{priceRange(p.min_price_satang, p.max_price_satang)}</Td>
                    <Td align="right">
                      <StockBadge stock={p.total_stock} threshold={5 * Math.max(1, p.variant_count) / 2} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{fmtDate(p.updated_at)}</Td>
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
