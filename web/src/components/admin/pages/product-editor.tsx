"use client";

import { ArrowLeft, ArrowRight, Grid3x3, Info, Plus, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBaht, parseBahtToSatang } from "@/lib/money";
import {
  createProduct,
  createVariant,
  deleteImage,
  deleteProduct,
  deleteVariant,
  getProduct,
  listCategories,
  reorderImages,
  updateProduct,
  updateVariant,
  uploadProductImage,
  type AdminProduct,
  type ProductStatus,
} from "@/lib/api/admin";
import type { Image } from "@/lib/api/types";
import { useApi } from "@/lib/admin/hooks";
import { comboKey, comboName, satangToInput, slugify, suggestSku, uniqueSku, variantMatrix, type OptionDef } from "@/lib/admin/format";
import { productSchema, validate } from "@/lib/admin/schemas";
import { IntInput, MoneyInput, ProductStatusBadge } from "../bits";
import { errorMessage, useConfirm, useToast } from "../overlay";
import { useSession } from "../session";
import { Badge, Button, Card, ErrorState, Field, IconButton, Input, PageHeader, PageFallback, Segmented, Select, Switch, Textarea } from "../ui";

type Row = { key: string; id?: number; option_values: Record<string, string>; sku: string; price: string; stock: string; weight: string; is_active: boolean; currentStock?: number };
type Form = {
  name: string;
  name_en: string;
  slug: string;
  subtitle: string;
  brand: string;
  category_id: string;
  description: string;
  tags: string;
  status: ProductStatus;
  featured: boolean;
  seo_title: string;
  seo_description: string;
};
const EMPTY: Form = { name: "", name_en: "", slug: "", subtitle: "", brand: "", category_id: "", description: "", tags: "", status: "draft", featured: false, seo_title: "", seo_description: "" };

export function ProductEditorPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id && params.id !== "new" ? Number(params.id) : null;
  const res = useApi(() => (id ? getProduct(id) : Promise.resolve(null)), `p${id}`);
  if (res.error) return <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />;
  if (res.loading && !res.data) return <PageFallback />;
  return <Editor key={`${id}-${res.data?.updated_at ?? "new"}`} product={res.data ?? null} onSaved={res.mutate} />;
}

function rowsFrom(p: AdminProduct): Row[] {
  return p.variants.map((v) => ({
    key: comboKey(v.option_values, p.options),
    id: v.id,
    option_values: v.option_values,
    sku: v.sku,
    price: satangToInput(v.price_satang),
    stock: String(v.stock),
    weight: String(v.weight_grams),
    is_active: v.is_active,
    currentStock: v.stock,
  }));
}

function Editor({ product, onSaved }: { product: AdminProduct | null; onSaved: (p: AdminProduct | null) => void }) {
  const router = useRouter();
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = can("catalog:write");
  const cats = useApi(listCategories, "cats");
  const [form, setForm] = useState<Form>(() =>
    product
      ? {
          name: product.name,
          name_en: product.name_en ?? "",
          slug: product.slug,
          subtitle: product.subtitle,
          brand: product.brand,
          category_id: String(product.category.id),
          description: product.description,
          tags: product.tags.join(", "),
          status: product.status,
          featured: product.featured,
          seo_title: product.seo.title,
          seo_description: product.seo.description,
        }
      : EMPTY,
  );
  const [options, setOptions] = useState<OptionDef[]>(() => (product ? product.options : [{ name: "ไซซ์", values: [] }, { name: "สี", values: [] }]));
  const [rows, setRows] = useState<Row[]>(() => (product ? rowsFrom(product) : [{ key: "", option_values: {}, sku: "", price: "", stock: "0", weight: "200", is_active: true }]));
  const [images, setImages] = useState<Image[]>(product?.images ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [bulkPrice, setBulkPrice] = useState("");
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  // per-product SKU salt: products whose names share a prefix no longer get the same suggested SKUs
  const [skuSalt] = useState(() => (product ? product.id.toString(36) : Math.random().toString(36).slice(2, 5)).toUpperCase());
  const upd = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // regenerate the variant matrix when options change (keeps rows with the same combination)
  function applyOptions(next: OptionDef[]) {
    setOptions(next);
    const combos = variantMatrix(next);
    setRows((old) => {
      const byKey = new Map(old.map((r) => [comboKey(r.option_values, next), r]));
      const template = old[0];
      if (combos.length === 0) return old.length ? [{ ...old[0], option_values: {}, key: "" }] : old;
      const taken = old.map((r) => r.sku);
      return combos.map((ov) => {
        const k = comboKey(ov, next);
        const hit = byKey.get(k);
        if (hit) return { ...hit, key: k, option_values: ov };
        const sku = uniqueSku(suggestSku(form.name_en || form.slug || "SKU", Object.values(ov), skuSalt), taken);
        taken.push(sku);
        return { key: k, option_values: ov, sku, price: template?.price ?? "", stock: "0", weight: template?.weight ?? "200", is_active: true };
      });
    });
  }

  const removed = useMemo(() => (product ? product.variants.filter((v) => !rows.some((r) => r.id === v.id)) : []), [product, rows]);

  async function save() {
    const v = validate(productSchema, { ...form, variants: rows.map((r) => ({ sku: r.sku, price: r.price, stock: r.stock, weight: r.weight })) });
    const dupSku = rows.map((r) => r.sku.trim().toUpperCase()).find((s, i, a) => s && a.indexOf(s) !== i);
    const errs = v.ok ? {} : { ...v.errors };
    if (dupSku) errs["variants.sku"] = `SKU ${dupSku} ซ้ำกัน`;
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast("กรุณาตรวจสอบข้อมูลที่ไฮไลต์", "error");
      return;
    }
    setErrors({});
    if (removed.length) {
      const ok = await confirm({ title: `ลบตัวเลือก ${removed.length} รายการ?`, body: `${removed.map((r) => r.sku).join(", ")} — ถ้าเคยมีคำสั่งซื้อ ระบบจะปิดการขายแทนการลบ`, confirmLabel: "ลบและบันทึก", danger: true });
      if (!ok) return;
    }
    const body = {
      name: form.name.trim(),
      name_en: form.name_en.trim(),
      slug: form.slug || undefined,
      subtitle: form.subtitle,
      description: form.description,
      category_id: Number(form.category_id),
      brand: form.brand,
      status: form.status,
      featured: form.featured,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      options: options.filter((o) => o.name.trim() && o.values.length),
      seo_title: form.seo_title,
      seo_description: form.seo_description,
    };
    const variantBody = (r: Row) => ({
      sku: r.sku.trim(),
      name: comboName(r.option_values, options) || "มาตรฐาน",
      option_values: r.option_values,
      price_satang: parseBahtToSatang(r.price)!,
      weight_grams: Number(r.weight),
      barcode: "",
      low_stock_threshold: 5,
    });
    setSaving(true);
    try {
      if (!product) {
        const created = await createProduct({ ...body, variants: rows.map((r) => ({ ...variantBody(r), stock: Number(r.stock) })) });
        toast("สร้างสินค้าแล้ว — อัปโหลดรูปได้เลย");
        router.replace(`/admin/products/${created.id}`);
        return;
      }
      await updateProduct(product.id, body);
      for (const r of rows) {
        if (r.id) {
          const orig = product.variants.find((x) => x.id === r.id)!;
          const vb = variantBody(r);
          const patch: Record<string, unknown> = {};
          if (vb.sku !== orig.sku) patch.sku = vb.sku;
          if (vb.price_satang !== orig.price_satang) patch.price_satang = vb.price_satang;
          if (vb.weight_grams !== orig.weight_grams) patch.weight_grams = vb.weight_grams;
          if (vb.name !== orig.name) patch.name = vb.name;
          if (JSON.stringify(vb.option_values) !== JSON.stringify(orig.option_values)) patch.option_values = vb.option_values;
          if (r.is_active !== orig.is_active) patch.is_active = r.is_active;
          if (Object.keys(patch).length) await updateVariant(r.id, patch);
        } else {
          await createVariant(product.id, { ...variantBody(r), stock: Number(r.stock) });
        }
      }
      for (const v of removed) await deleteVariant(v.id);
      const fresh = await getProduct(product.id);
      toast("บันทึกแล้ว");
      onSaved(fresh);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!product) return;
    const ok = await confirm({ title: `เก็บ “${product.name}” ถาวร?`, body: "สินค้าจะหายจากหน้าร้านและรายการหลัก ประวัติคำสั่งซื้อยังอยู่ครบ", confirmLabel: "เก็บถาวร", danger: true });
    if (!ok) return;
    try {
      await deleteProduct(product.id);
      toast("เก็บสินค้าถาวรแล้ว");
      router.replace("/admin/products");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const catList = cats.data?.data ?? [];
  const minPrice = rows.map((r) => parseBahtToSatang(r.price)).filter((x): x is number => x !== null);
  return (
    <div>
      <PageHeader
        back={{ href: "/admin/products", label: "สินค้า" }}
        title={product ? product.name : "เพิ่มสินค้า"}
        subtitle={product ? <span className="inline-flex items-center gap-2"><ProductStatusBadge status={product.status} /> /p/{product.slug}</span> : "กรอกข้อมูลแล้วบันทึก จากนั้นอัปโหลดรูปได้"}
        actions={product && canWrite ? <Button variant="danger-ghost" icon={Trash2} onClick={archive}>เก็บถาวร</Button> : null}
      />
      <fieldset disabled={!canWrite} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="ข้อมูลสินค้า">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ชื่อสินค้า (ไทย)" required error={errors.name} htmlFor="name">
                <Input id="name" value={form.name} invalid={Boolean(errors.name)} onChange={(e) => upd("name", e.target.value)} />
              </Field>
              <Field label="ชื่อสินค้า (English)" error={errors.name_en} hint="ใช้ค้นหาและ SKU อัตโนมัติ" htmlFor="name_en">
                <Input
                  id="name_en"
                  value={form.name_en}
                  onChange={(e) => {
                    upd("name_en", e.target.value);
                    if (!slugTouched) upd("slug", slugify(e.target.value).replace(/[ก-๙]/g, ""));
                  }}
                />
              </Field>
              <Field label="คำโปรย" htmlFor="subtitle">
                <Input id="subtitle" value={form.subtitle} onChange={(e) => upd("subtitle", e.target.value)} placeholder="เช่น ผ้าลินินแท้ ใส่สบาย" />
              </Field>
              <Field label="แบรนด์" htmlFor="brand">
                <Input id="brand" value={form.brand} onChange={(e) => upd("brand", e.target.value)} />
              </Field>
              <Field label="รายละเอียด" className="sm:col-span-2" hint="รองรับ Markdown (หัวข้อ, รายการ -)" htmlFor="desc">
                <Textarea id="desc" rows={6} value={form.description} onChange={(e) => upd("description", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="ตัวเลือกสินค้า (ไซซ์ × สี)" actions={<Badge tone="blue">{rows.length} ตัวเลือก</Badge>}>
            <div className="flex flex-col gap-3">
              {options.map((o, oi) => (
                <OptionEditor
                  key={oi}
                  option={o}
                  onChange={(n) => applyOptions(options.map((x, i) => (i === oi ? n : x)))}
                  onRemove={() => applyOptions(options.filter((_, i) => i !== oi))}
                />
              ))}
              {options.length < 3 ? (
                <Button size="sm" variant="outline" icon={Plus} className="self-start" onClick={() => applyOptions([...options, { name: options.some((o) => o.name === "สี") ? "วัสดุ" : "สี", values: [] }])}>
                  เพิ่มตัวเลือก
                </Button>
              ) : null}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-[10px] bg-accent-soft px-3 py-2.5 text-[13px] text-ink">
              <Info className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />
              <p>
                กรอกเฉพาะ <b>ราคาขายปกติ</b> — ไม่มีช่อง “ราคาก่อนลด” ราคาขีดฆ่าบนหน้าร้านคำนวณอัตโนมัติจาก<b>ราคาต่ำสุดในประวัติราคา 30 วัน</b>ก่อนโปรเริ่ม (ตามกฎ สคบ.)
                การเปลี่ยนราคาถูกบันทึกในประวัติราคาให้เอง
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2">
              <Field label="ใช้ราคาเดียวกันทุกแถว" className="w-40">
                <MoneyInput value={bulkPrice} onChange={setBulkPrice} />
              </Field>
              <Button size="md" variant="outline" disabled={parseBahtToSatang(bulkPrice) === null} onClick={() => setRows((rs) => rs.map((r) => ({ ...r, price: bulkPrice })))}>
                ใช้กับทุกแถว
              </Button>
            </div>
            {errors["variants.sku"] || errors.variants ? <p className="mt-2 text-xs text-danger">{errors["variants.sku"] ?? errors.variants}</p> : null}

            <div className="-mx-4 mt-3 overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-2">
                    <th className="px-4 py-2 font-medium">ตัวเลือก</th>
                    <th className="px-2 py-2 font-medium">SKU</th>
                    <th className="w-36 px-2 py-2 font-medium">ราคา</th>
                    <th className="w-24 px-2 py-2 font-medium">สต็อก</th>
                    <th className="w-24 px-2 py-2 font-medium">น้ำหนัก (ก.)</th>
                    <th className="w-20 px-2 py-2 font-medium">ขาย</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const set = (patch: Partial<Row>) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    return (
                      <tr key={r.key || i} className="border-t border-hairline-soft">
                        <td className="px-4 py-2">
                          <span className="font-medium text-ink">{comboName(r.option_values, options) || "มาตรฐาน"}</span>
                          {r.id ? null : <Badge tone="blue" className="ml-2">ใหม่</Badge>}
                        </td>
                        <td className="px-2 py-2">
                          <Input value={r.sku} onChange={(e) => set({ sku: e.target.value.toUpperCase() })} invalid={Boolean(errors[`variants.${i}.sku`])} aria-label="SKU" className="font-mono text-[13px]" />
                        </td>
                        <td className="px-2 py-2">
                          <MoneyInput value={r.price} onChange={(v) => set({ price: v })} invalid={Boolean(errors[`variants.${i}.price`])} aria-label="ราคา" />
                        </td>
                        <td className="px-2 py-2">
                          {r.id ? (
                            <Link href={`/admin/inventory?q=${encodeURIComponent(r.sku)}`} className="text-link hover:underline" title="ปรับสต็อกพร้อมเหตุผลที่หน้าสต็อก">
                              {r.currentStock}
                            </Link>
                          ) : (
                            <IntInput value={r.stock} onChange={(v) => set({ stock: v })} invalid={Boolean(errors[`variants.${i}.stock`])} aria-label="สต็อกเริ่มต้น" />
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <IntInput value={r.weight} onChange={(v) => set({ weight: v })} invalid={Boolean(errors[`variants.${i}.weight`])} aria-label="น้ำหนัก" />
                        </td>
                        <td className="px-2 py-2">
                          <Switch checked={r.is_active} onChange={(v) => set({ is_active: v })} label={<span className="sr-only">เปิดขาย</span>} />
                        </td>
                        <td className="pr-3">
                          {rows.length > 1 ? <IconButton size="sm" label="ลบแถว" icon={X} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {minPrice.length ? <p className="mt-2 text-xs text-ink-2">ช่วงราคาบนหน้าร้าน: {formatBaht(Math.min(...minPrice))}{Math.max(...minPrice) !== Math.min(...minPrice) ? ` – ${formatBaht(Math.max(...minPrice))}` : ""}</p> : null}
          </Card>

          <ImagesCard product={product} images={images} setImages={setImages} />

          <Card title="SEO">
            <div className="grid gap-4">
              <Field label="Slug (URL)" error={errors.slug} hint={`/p/${form.slug || "…"}`} htmlFor="slug">
                <Input
                  id="slug"
                  value={form.slug}
                  invalid={Boolean(errors.slug)}
                  onChange={(e) => {
                    setSlugTouched(true);
                    upd("slug", e.target.value.toLowerCase());
                  }}
                  placeholder="linen-shirt"
                />
              </Field>
              <Field label={`ชื่อหน้า (${form.seo_title.length}/70)`} error={errors.seo_title} htmlFor="seo_title">
                <Input id="seo_title" value={form.seo_title} onChange={(e) => upd("seo_title", e.target.value)} placeholder={form.name ? `${form.name} | ShopShip` : ""} />
              </Field>
              <Field label={`คำอธิบาย (${form.seo_description.length}/160)`} error={errors.seo_description} htmlFor="seo_desc">
                <Textarea id="seo_desc" rows={3} value={form.seo_description} onChange={(e) => upd("seo_description", e.target.value)} />
              </Field>
              <div className="rounded-[10px] border border-hairline-soft p-3">
                <p className="text-xs text-ink-2">ตัวอย่างบน Google</p>
                <p className="mt-1 truncate text-[15px] text-[#1a0dab]">{form.seo_title || (form.name ? `${form.name} | ShopShip` : "ชื่อสินค้า | ShopShip")}</p>
                <p className="text-xs text-success">shopship.co/p/{form.slug || "…"}</p>
                <p className="line-clamp-2 text-[13px] text-ink-2">{form.seo_description || form.description.slice(0, 160) || "คำอธิบายสินค้า"}</p>
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card title="การเผยแพร่">
            <Segmented
              value={form.status === "archived" ? "hidden" : form.status}
              onChange={(v) => upd("status", v as ProductStatus)}
              options={[
                { value: "active", label: "เผยแพร่" },
                { value: "hidden", label: "ซ่อน" },
                { value: "draft", label: "ร่าง" },
              ]}
              className="w-full [&>button]:flex-1"
            />
            <p className="mt-2 text-xs text-ink-2">{form.status === "active" ? "ลูกค้าเห็นและสั่งซื้อได้" : form.status === "hidden" ? "ไม่แสดงบนหน้าร้าน แต่ลิงก์เดิมจะ 404" : "ยังไม่พร้อมขาย"}</p>
            <div className="mt-4">
              <Switch checked={form.featured} onChange={(v) => upd("featured", v)} label="สินค้าแนะนำ" description="แสดงในส่วนแนะนำของหน้าแรก" />
            </div>
          </Card>
          <Card title="จัดหมวด">
            <div className="flex flex-col gap-4">
              <Field label="หมวดหมู่" required error={errors.category_id} htmlFor="cat">
                <Select id="cat" value={form.category_id} invalid={Boolean(errors.category_id)} onChange={(e) => upd("category_id", e.target.value)}>
                  <option value="">เลือกหมวดหมู่</option>
                  {catList
                    .filter((c) => c.parent_id === null)
                    .map((p) => (
                      <optgroup key={p.id} label={p.name}>
                        <option value={p.id}>{p.name}</option>
                        {catList
                          .filter((c) => c.parent_id === p.id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              — {c.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                </Select>
              </Field>
              <Field label="แท็ก" hint="คั่นด้วยจุลภาค เช่น linen, summer" htmlFor="tags">
                <Input id="tags" value={form.tags} onChange={(e) => upd("tags", e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>
      </fieldset>

      {canWrite ? (
        <div className="pb-safe sticky bottom-0 z-30 -mx-3 mt-4 border-t border-hairline-soft bg-surface/90 backdrop-blur-xl sm:-mx-5 md:-mx-6">
          <div className="flex items-center justify-end gap-2 px-4 py-2.5 md:px-6">
            <span className="mr-auto hidden text-[13px] text-ink-2 sm:block">{product ? "การเปลี่ยนแปลงยังไม่ถูกบันทึกจนกว่าจะกดบันทึก" : "สินค้าใหม่"}</span>
            <Button onClick={() => router.push("/admin/products")}>ยกเลิก</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {product ? "บันทึก" : "สร้างสินค้า"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OptionEditor({ option, onChange, onRemove }: { option: OptionDef; onChange: (o: OptionDef) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const vals = draft
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !option.values.includes(s));
    if (vals.length) onChange({ ...option, values: [...option.values, ...vals] });
    setDraft("");
  };
  const presets = option.name === "ไซซ์" ? ["XS", "S", "M", "L", "XL", "XXL"] : option.name === "สี" ? ["ขาว", "ดำ", "กรมท่า", "เทา", "ครีม"] : [];
  return (
    <div className="rounded-[10px] border border-hairline-soft p-3">
      <div className="flex items-center gap-2">
        <Grid3x3 className="size-4 text-ink-2" aria-hidden />
        <Input value={option.name} onChange={(e) => onChange({ ...option, name: e.target.value })} className="h-9 max-w-[160px] font-medium" aria-label="ชื่อตัวเลือก" />
        <IconButton label="ลบตัวเลือกนี้" icon={Trash2} size="sm" onClick={onRemove} className="ml-auto" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {option.values.map((v) => (
          <span key={v} className="inline-flex h-8 items-center gap-1 rounded-full bg-canvas-alt pl-3 pr-1 text-[13px]">
            {v}
            <button type="button" aria-label={`ลบ ${v}`} onClick={() => onChange({ ...option, values: option.values.filter((x) => x !== v) })} className="flex size-6 items-center justify-center rounded-full text-ink-2 hover:bg-hairline-soft">
              <X className="size-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="พิมพ์แล้วกด Enter"
          aria-label={`เพิ่มค่าของ ${option.name}`}
          className="h-8 min-w-[140px] flex-1 rounded-full border border-dashed border-hairline bg-transparent px-3 text-[13px] focus:border-accent focus:outline-none"
        />
      </div>
      {presets.some((p) => !option.values.includes(p)) ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {presets
            .filter((p) => !option.values.includes(p))
            .map((p) => (
              <button key={p} type="button" onClick={() => onChange({ ...option, values: [...option.values, p] })} className="h-7 rounded-full border border-hairline-soft px-2.5 text-xs text-ink-2 hover:border-accent hover:text-link">
                + {p}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function ImagesCard({ product, images, setImages }: { product: AdminProduct | null; images: Image[]; setImages: (f: (i: Image[]) => Image[]) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dirtyOrder, setDirtyOrder] = useState(false);
  const order = useRef(images.map((i) => i.id));
  useEffect(() => {
    order.current = images.map((i) => i.id);
  }, [images]);

  if (!product)
    return (
      <Card title="รูปสินค้า">
        <p className="text-sm text-ink-2">บันทึกสินค้าก่อน แล้วจึงอัปโหลดรูปได้ (JPEG/PNG/WebP ไม่เกิน 8 MB)</p>
      </Card>
    );

  async function upload(files: FileList | null) {
    if (!files?.length || !product) return;
    const list = [...files];
    const bad = list.find((f) => !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 8 * 1024 * 1024);
    if (bad) return toast(`ไฟล์ ${bad.name} ต้องเป็น JPEG/PNG/WebP และไม่เกิน 8 MB`, "error");
    setUploading(list.length);
    for (const f of list) {
      try {
        const img = await uploadProductImage(product.id, f, product.name);
        setImages((i) => [...i, img]);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
      setUploading((n) => n - 1);
    }
    if (fileRef.current) fileRef.current.value = "";
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= images.length || from === to) return;
    setImages((i) => {
      const n = [...i];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x);
      return n;
    });
    setDirtyOrder(true);
  };
  async function saveOrder() {
    try {
      await reorderImages(product!.id, order.current);
      setDirtyOrder(false);
      toast("บันทึกลำดับรูปแล้ว");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function remove(img: Image) {
    if (!(await confirm({ title: "ลบรูปนี้?", body: "ลบแล้วกู้คืนไม่ได้", confirmLabel: "ลบรูป", danger: true }))) return;
    try {
      await deleteImage(img.id);
      setImages((i) => i.filter((x) => x.id !== img.id));
      toast("ลบรูปแล้ว");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  return (
    <Card
      title="รูปสินค้า"
      actions={
        dirtyOrder ? (
          <Button size="sm" variant="primary" onClick={saveOrder}>
            บันทึกลำดับ
          </Button>
        ) : (
          <span className="text-xs text-ink-2">ลากเพื่อจัดลำดับ · รูปแรก = รูปหลัก</span>
        )
      }
    >
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
        {images.map((img, i) => (
          <div
            key={img.id}
            draggable
            onDragStart={() => setDragId(img.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const from = images.findIndex((x) => x.id === dragId);
              move(from, i);
              setDragId(null);
            }}
            className={`group relative aspect-square overflow-hidden rounded-[10px] border bg-canvas-alt ${dragId === img.id ? "opacity-40" : ""} ${i === 0 ? "border-accent" : "border-hairline-soft"}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.alt} className="size-full object-cover" draggable={false} />
            {i === 0 ? <span className="absolute left-1.5 top-1.5 rounded-full bg-accent px-1.5 text-[10px] font-medium text-white">หลัก</span> : null}
            <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
              <button type="button" aria-label="เลื่อนซ้าย" onClick={() => move(i, i - 1)} disabled={i === 0} className="flex size-8 items-center justify-center rounded-full bg-white/90 text-ink shadow disabled:opacity-30">
                <ArrowLeft className="size-4" aria-hidden />
              </button>
              <button type="button" aria-label="ลบรูป" onClick={() => remove(img)} className="flex size-8 items-center justify-center rounded-full bg-white/90 text-danger shadow">
                <Trash2 className="size-4" aria-hidden />
              </button>
              <button type="button" aria-label="เลื่อนขวา" onClick={() => move(i, i + 1)} disabled={i === images.length - 1} className="flex size-8 items-center justify-center rounded-full bg-white/90 text-ink shadow disabled:opacity-30">
                <ArrowRight className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
          }}
          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-hairline text-[13px] text-ink-2 hover:border-accent hover:text-link"
        >
          <Upload className="size-5" aria-hidden />
          {uploading ? `กำลังอัปโหลด ${uploading}…` : "เพิ่มรูป"}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
    </Card>
  );
}
