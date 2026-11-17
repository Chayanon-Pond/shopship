"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, Zap } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { formatBaht, formatBp, parseBahtToSatang } from "@/lib/money";
import { createFlashSale, deleteFlashSale, getFlashSale, listCampaigns, replaceFlashItems, updateFlashSale, type AdminFlashSale } from "@/lib/api/admin";
import { useApi } from "@/lib/admin/hooks";
import { fromBkkInput, satangToInput, toBkkInput, windowStatus } from "@/lib/admin/format";
import { flashItemSchema, flashSaleSchema, validate } from "@/lib/admin/schemas";
import { IntInput, MoneyInput, WindowBadge } from "../bits";
import { errorMessage, useConfirm, useToast } from "../overlay";
import { VariantPicker } from "../pickers";
import { useSession } from "../session";
import { Button, Card, EmptyState, ErrorState, Field, IconButton, Input, PageFallback, PageHeader, Progress, Select } from "../ui";

type Item = { variant_id: number; sku: string; product_name: string; variant_name: string; list_price_satang: number; sale_price: string; qty_limit: string; per_customer_limit: string; sold_qty: number };

export function FlashEditorPage() {
  const params = useParams<{ id: string }>();
  const id = params.id && params.id !== "new" ? Number(params.id) : null;
  const res = useApi(() => (id ? getFlashSale(id) : Promise.resolve(null)), `fs${id}`);
  if (res.error) return <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />;
  if (res.loading && !res.data) return <PageFallback />;
  return <FlashEditor key={id ?? "new"} sale={res.data ?? null} />;
}

function FlashEditor({ sale }: { sale: AdminFlashSale | null }) {
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = can("promotions:write");
  const camps = useApi(() => listCampaigns(), "camps");
  const [f, setF] = useState({
    name: sale?.name ?? "",
    label: sale?.label ?? "",
    starts_at: toBkkInput(sale?.starts_at),
    ends_at: toBkkInput(sale?.ends_at),
    campaign_id: sale?.campaign_id ? String(sale.campaign_id) : "",
    status: sale?.status ?? "active",
  });
  const [items, setItems] = useState<Item[]>(
    () =>
      sale?.items
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i) => ({ variant_id: i.variant_id, sku: i.sku, product_name: i.product_name, variant_name: i.variant_name, list_price_satang: i.list_price_satang, sale_price: satangToInput(i.sale_price_satang), qty_limit: String(i.qty_limit), per_customer_limit: i.per_customer_limit ? String(i.per_customer_limit) : "", sold_qty: i.sold_qty })) ?? [],
  );
  const [picker, setPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const live = sale ? windowStatus(sale.starts_at, sale.ends_at) : null;

  async function save() {
    const errs: Record<string, string> = {};
    const head = validate(flashSaleSchema, f);
    if (!head.ok) Object.assign(errs, head.errors);
    items.forEach((it, i) => {
      const v = validate(flashItemSchema, { sale_price: it.sale_price, qty_limit: it.qty_limit, per_customer_limit: it.per_customer_limit });
      if (!v.ok) for (const [k, m] of Object.entries(v.errors)) errs[`items.${i}.${k}`] = m;
      const sp = parseBahtToSatang(it.sale_price);
      if (sp !== null && sp >= it.list_price_satang) errs[`items.${i}.sale_price`] = "ต้องต่ำกว่าราคาปกติ";
      if (Number(it.qty_limit) < it.sold_qty) errs[`items.${i}.qty_limit`] = `ต่ำกว่าที่ขายไปแล้ว (${it.sold_qty})`;
    });
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast("กรุณาตรวจสอบข้อมูลที่ไฮไลต์", "error");
      return;
    }
    setErrors({});
    const body = { name: f.name, label: f.label, starts_at: fromBkkInput(f.starts_at)!, ends_at: fromBkkInput(f.ends_at)!, campaign_id: f.campaign_id ? Number(f.campaign_id) : null, status: f.status };
    setBusy(true);
    try {
      const s = sale ? await updateFlashSale(sale.id, body) : await createFlashSale(body);
      await replaceFlashItems(
        s.id,
        items.map((it, i) => ({ variant_id: it.variant_id, sale_price_satang: parseBahtToSatang(it.sale_price)!, qty_limit: Number(it.qty_limit), per_customer_limit: it.per_customer_limit ? Number(it.per_customer_limit) : null, sort_order: i + 1 })),
      );
      toast("บันทึก Flash Sale แล้ว");
      if (!sale) router.replace(`/admin/flash-sales/${s.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!sale || !(await confirm({ title: `ลบ “${sale.name}”?`, body: "ถ้ามียอดขายแล้ว ระบบจะเก็บถาวรแทน", confirmLabel: "ลบ", danger: true }))) return;
    try {
      await deleteFlashSale(sale.id);
      toast("ลบแล้ว");
      router.replace("/admin/promotions?tab=flash");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  const move = (i: number, d: number) => setItems((xs) => {
    const n = [...xs];
    const j = i + d;
    if (j < 0 || j >= n.length) return xs;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  return (
    <div>
      <PageHeader
        back={{ href: "/admin/promotions?tab=flash", label: "Flash Sale" }}
        title={sale ? sale.name : "สร้าง Flash Sale"}
        subtitle={live ? <WindowBadge status={live} /> : "ตั้งช่วงเวลา เลือกสินค้า ใส่ราคาพิเศษและโควตา"}
        actions={sale && canWrite ? <Button variant="danger-ghost" icon={Trash2} onClick={remove}>ลบ</Button> : null}
      />
      <fieldset disabled={!canWrite} className="flex flex-col gap-4">
        <Card title="ตั้งค่า">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="ชื่อ (ภายใน)" required error={errors.name}>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={Boolean(errors.name)} />
            </Field>
            <Field label="ป้ายบนหน้าร้าน" required error={errors.label}>
              <Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} invalid={Boolean(errors.label)} placeholder="Flash Sale 12.12" />
            </Field>
            <Field label="แคมเปญ">
              <Select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}>
                <option value="">— ไม่ผูก —</option>
                {(camps.data?.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="เริ่ม (เวลาไทย)" required error={errors.starts_at}>
              <Input type="datetime-local" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} invalid={Boolean(errors.starts_at)} />
            </Field>
            <Field label="สิ้นสุด (เวลาไทย)" required error={errors.ends_at}>
              <Input type="datetime-local" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} invalid={Boolean(errors.ends_at)} />
            </Field>
            <Field label="สถานะ">
              <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as AdminFlashSale["status"] })}>
                <option value="active">เปิด (ตามเวลา)</option>
                <option value="draft">ร่าง</option>
                <option value="paused">หยุดชั่วคราว</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card pad={false} title={`สินค้า (${items.length})`} actions={canWrite ? <Button size="sm" variant="outline" icon={Plus} onClick={() => setPicker(true)}>เพิ่มสินค้า</Button> : null}>
          {items.length === 0 ? (
            <EmptyState icon={Zap} title="ยังไม่มีสินค้า" action={canWrite ? <Button variant="primary" icon={Plus} onClick={() => setPicker(true)}>เพิ่มสินค้า</Button> : null} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-hairline-soft text-left text-xs text-ink-2">
                    <th className="px-4 py-2 font-medium">สินค้า</th>
                    <th className="px-2 py-2 font-medium">ราคาปกติ</th>
                    <th className="w-36 px-2 py-2 font-medium">ราคา Flash</th>
                    <th className="w-24 px-2 py-2 font-medium">โควตา</th>
                    <th className="w-24 px-2 py-2 font-medium">ต่อคน</th>
                    <th className="w-40 px-2 py-2 font-medium">ขายแล้ว</th>
                    <th className="w-28" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => {
                    const set = (p: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
                    const sp = parseBahtToSatang(it.sale_price);
                    const off = sp !== null && sp < it.list_price_satang ? Math.round(((it.list_price_satang - sp) * 10000) / it.list_price_satang) : null;
                    return (
                      <tr key={it.variant_id} className="border-b border-hairline-soft align-top">
                        <td className="px-4 py-2">
                          <span className="block text-ink">{it.product_name}</span>
                          <span className="text-xs text-ink-2">
                            {it.variant_name} · <span className="font-mono">{it.sku}</span>
                          </span>
                        </td>
                        <td className="px-2 py-3 tabular-nums text-ink-2">{formatBaht(it.list_price_satang)}</td>
                        <td className="px-2 py-2">
                          <MoneyInput value={it.sale_price} onChange={(v) => set({ sale_price: v })} invalid={Boolean(errors[`items.${i}.sale_price`])} aria-label="ราคา Flash" />
                          <span className={`text-xs ${errors[`items.${i}.sale_price`] ? "text-danger" : "text-sale"}`}>{errors[`items.${i}.sale_price`] ?? (off !== null ? `ลด ${formatBp(off)}` : "")}</span>
                        </td>
                        <td className="px-2 py-2">
                          <IntInput value={it.qty_limit} onChange={(v) => set({ qty_limit: v })} invalid={Boolean(errors[`items.${i}.qty_limit`])} aria-label="โควตา" />
                          {errors[`items.${i}.qty_limit`] ? <span className="text-xs text-danger">{errors[`items.${i}.qty_limit`]}</span> : null}
                        </td>
                        <td className="px-2 py-2">
                          <IntInput value={it.per_customer_limit} onChange={(v) => set({ per_customer_limit: v })} placeholder="ไม่จำกัด" aria-label="จำกัดต่อคน" />
                        </td>
                        <td className="px-2 py-3">
                          <Progress value={it.sold_qty} max={Number(it.qty_limit) || 1} tone="orange" label="ขายแล้ว" />
                          <span className="text-xs text-ink-2">
                            {it.sold_qty}/{it.qty_limit || 0}
                          </span>
                        </td>
                        <td className="whitespace-nowrap pr-3 pt-2 text-right">
                          <IconButton size="sm" label="เลื่อนขึ้น" icon={ArrowUp} onClick={() => move(i, -1)} disabled={i === 0} />
                          <IconButton size="sm" label="เลื่อนลง" icon={ArrowDown} onClick={() => move(i, 1)} disabled={i === items.length - 1} />
                          <IconButton size="sm" label="นำออก" icon={Trash2} disabled={it.sold_qty > 0} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </fieldset>
      {canWrite ? (
        <div className="pb-safe sticky bottom-0 z-30 -mx-3 mt-4 border-t border-hairline-soft bg-surface/90 backdrop-blur-xl sm:-mx-5 md:-mx-6">
          <div className="flex items-center justify-end gap-2 px-4 py-2.5 md:px-6">
            <Button onClick={() => router.push("/admin/promotions?tab=flash")}>ยกเลิก</Button>
            <Button variant="primary" loading={busy} onClick={save}>
              บันทึก
            </Button>
          </div>
        </div>
      ) : null}
      <VariantPicker
        open={picker}
        onClose={() => setPicker(false)}
        picked={new Set(items.map((i) => i.variant_id))}
        onPick={(v) =>
          setItems((xs) =>
            xs.some((x) => x.variant_id === v.variant_id)
              ? xs
              : [...xs, { variant_id: v.variant_id, sku: v.sku, product_name: v.product_name, variant_name: v.variant_name, list_price_satang: v.price_satang, sale_price: "", qty_limit: String(Math.min(50, Math.max(1, v.stock))), per_customer_limit: "1", sold_qty: 0 }],
          )
        }
      />
    </div>
  );
}
