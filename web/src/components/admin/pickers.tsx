"use client";

/** Product / variant / category pickers (dialogs) shared by flash sales, targets and the simulator. */
import { Check, ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { formatBaht } from "@/lib/money";
import { getProduct, listCategories, listProducts, listUsers, type AdminUser } from "@/lib/api/admin";
import { useApi, useDebounced } from "@/lib/admin/hooks";
import { TIER_LABEL } from "@/lib/admin/format";
import { Dialog } from "./overlay";
import { Badge, Button, EmptyState, Input, Segmented, Skeleton } from "./ui";

export type PickedVariant = { variant_id: number; sku: string; product_id: number; product_name: string; variant_name: string; price_satang: number; stock: number; image_url: string };
export type PickedTarget = { type: "category" | "product" | "variant"; id: number; name: string };

function ProductSearch({ onOpen, selectedProducts, onPickProduct }: { onOpen: (id: number) => void; selectedProducts?: Set<number>; onPickProduct?: (p: { id: number; name: string }) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const res = useApi(() => listProducts({ q: dq || undefined, per_page: 12, status: undefined }), `ps-${dq}`);
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
        <Input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อสินค้าหรือ SKU" className="pl-9" aria-label="ค้นหาสินค้า" />
      </div>
      <ul className="mt-3 divide-y divide-hairline-soft">
        {!res.data
          ? Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="py-2">
                <Skeleton className="h-10" />
              </li>
            ))
          : res.data.data.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image_url || "/mock/canvas-tote.svg"} alt="" className="size-10 rounded-[8px] border border-hairline-soft object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                  <span className="text-xs text-ink-2">
                    {p.variant_count} ตัวเลือก · {formatBaht(p.min_price_satang)}
                  </span>
                </span>
                {onPickProduct ? (
                  <Button size="sm" variant={selectedProducts?.has(p.id) ? "secondary" : "outline"} icon={selectedProducts?.has(p.id) ? Check : undefined} onClick={() => onPickProduct({ id: p.id, name: p.name })}>
                    ทั้งสินค้า
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => onOpen(p.id)} aria-label={`ดูตัวเลือกของ ${p.name}`}>
                  ตัวเลือก <ChevronRight className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
      </ul>
      {res.data && res.data.data.length === 0 ? <EmptyState title="ไม่พบสินค้า" /> : null}
    </div>
  );
}

function VariantList({ productId, onPick, picked, onBack }: { productId: number; onPick: (v: PickedVariant) => void; picked: Set<number>; onBack: () => void }) {
  const res = useApi(() => getProduct(productId), `pv-${productId}`);
  const p = res.data;
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-2 text-[13px] text-link hover:underline">
        ← กลับไปค้นหา
      </button>
      {!p ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <p className="mb-2 font-medium text-ink">{p.name}</p>
          <ul className="divide-y divide-hairline-soft">
            {p.variants
              .filter((v) => v.is_active)
              .map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => onPick({ variant_id: v.id, sku: v.sku, product_id: p.id, product_name: p.name, variant_name: v.name, price_satang: v.price_satang, stock: v.stock, image_url: p.images[0]?.url ?? "" })}
                    className="flex min-h-12 w-full items-center gap-3 px-1 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-ink">{v.name}</span>
                      <span className="font-mono text-xs text-ink-2">{v.sku}</span>
                    </span>
                    <span className="text-xs text-ink-2">สต็อก {v.stock}</span>
                    <span className="w-20 text-right font-medium tabular-nums">{formatBaht(v.price_satang)}</span>
                    {picked.has(v.id) ? <Check className="size-4 text-success" aria-label="เลือกแล้ว" /> : <span className="size-4" />}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function VariantPicker({ open, onClose, onPick, picked = new Set<number>(), title = "เลือกสินค้า" }: { open: boolean; onClose: () => void; onPick: (v: PickedVariant) => void; picked?: Set<number>; title?: string }) {
  const [productId, setProductId] = useState<number | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title={title} size="md" footer={<Button variant="primary" onClick={onClose}>เสร็จ</Button>}>
      {productId ? <VariantList productId={productId} onPick={onPick} picked={picked} onBack={() => setProductId(null)} /> : <ProductSearch onOpen={setProductId} />}
    </Dialog>
  );
}

export function TargetPicker({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: PickedTarget[]; onChange: (t: PickedTarget[]) => void }) {
  const [tab, setTab] = useState<"category" | "product">("category");
  const [productId, setProductId] = useState<number | null>(null);
  const cats = useApi(listCategories, "cats", open);
  const has = (type: PickedTarget["type"], id: number) => value.some((t) => t.type === type && t.id === id);
  const toggle = (t: PickedTarget) => onChange(has(t.type, t.id) ? value.filter((x) => !(x.type === t.type && x.id === t.id)) : [...value, t]);
  const all = cats.data?.data ?? [];
  return (
    <Dialog open={open} onClose={onClose} title="เลือกสินค้าที่ร่วมรายการ" size="md" footer={<Button variant="primary" onClick={onClose}>เสร็จ ({value.length})</Button>}>
      <Segmented value={tab} onChange={(v) => (setTab(v), setProductId(null))} options={[{ value: "category", label: "หมวดหมู่" }, { value: "product", label: "สินค้า / ตัวเลือก" }]} className="mb-3" />
      {tab === "category" ? (
        !cats.data ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="divide-y divide-hairline-soft">
            {all
              .filter((c) => c.parent_id === null)
              .flatMap((p) => [p, ...all.filter((c) => c.parent_id === p.id)])
              .map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => toggle({ type: "category", id: c.id, name: c.name })} className={`flex min-h-11 w-full items-center gap-2 py-2 text-left text-sm hover:bg-surface-2 ${c.parent_id ? "pl-6" : "pl-1 font-medium"}`}>
                    <span className="flex-1">{c.name}</span>
                    {c.parent_id === null ? <span className="text-xs text-ink-2">รวมหมวดย่อย</span> : null}
                    {has("category", c.id) ? <Check className="size-4 text-success" aria-label="เลือกแล้ว" /> : <span className="size-4" />}
                  </button>
                </li>
              ))}
          </ul>
        )
      ) : productId ? (
        <VariantList productId={productId} picked={new Set(value.filter((t) => t.type === "variant").map((t) => t.id))} onPick={(v) => toggle({ type: "variant", id: v.variant_id, name: `${v.product_name} (${v.variant_name})` })} onBack={() => setProductId(null)} />
      ) : (
        <ProductSearch onOpen={setProductId} selectedProducts={new Set(value.filter((t) => t.type === "product").map((t) => t.id))} onPickProduct={(p) => toggle({ type: "product", id: p.id, name: p.name })} />
      )}
    </Dialog>
  );
}

export function UserPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (u: AdminUser) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const res = useApi(() => listUsers({ role: "customer", q: dq || undefined, per_page: 12 }), `up-${dq}`, open);
  return (
    <Dialog open={open} onClose={onClose} title="เลือกลูกค้า" size="md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
        <Input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ชื่อ อีเมล เบอร์โทร" className="pl-9" aria-label="ค้นหาลูกค้า" />
      </div>
      <ul className="mt-3 divide-y divide-hairline-soft">
        {(res.data?.data ?? []).map((u) => (
          <li key={u.id}>
            <button type="button" onClick={() => onPick(u)} className="flex min-h-12 w-full items-center gap-2 py-2 text-left text-sm hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block text-ink">{u.name}</span>
                <span className="text-xs text-ink-2">{u.email}</span>
              </span>
              {u.group ? <Badge tone="purple">{u.group.name}</Badge> : null}
              {u.tier !== "standard" ? <Badge tone="orange">{TIER_LABEL[u.tier]}</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
