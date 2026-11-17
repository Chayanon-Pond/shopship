"use client";

import { FlaskConical, Info, Plus, Tag, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { formatBaht, parseBahtToSatang } from "@/lib/money";
import {
  addCodes,
  createPromotion,
  deactivateCode,
  deletePromotion,
  getPromotion,
  listCampaigns,
  listCustomerGroups,
  listRedemptions,
  updatePromotion,
  type PromotionInput,
} from "@/lib/api/admin";
import type { AdminPromotion, PromotionKind, Tier } from "@/lib/api/types";
import { useApi } from "@/lib/admin/hooks";
import { bpToInput, deriveLayer, fmtDateTime, fromBkkInput, normalizeCode, parsePercentToBp, PROMO_KIND_LABEL, satangToInput, TIER_LABEL, toBkkInput } from "@/lib/admin/format";
import { LAYER_LABEL, promoValue } from "@/lib/admin/promo";
import { promotionSchema, validate } from "@/lib/admin/schemas";
import { IntInput, MoneyInput, PercentInput, PromoStateBadge } from "../../bits";
import { errorMessage, useConfirm, useToast } from "../../overlay";
import { TargetPicker, type PickedTarget } from "../../pickers";
import { useSession } from "../../session";
import { Badge, Button, Card, Checkbox, ErrorState, Field, IconButton, Input, PageFallback, PageHeader, Pagination, Segmented, Select, Switch, Textarea } from "../../ui";
import { CodeGenerator } from "./shared";

const KINDS: { kind: PromotionKind; desc: string; code: boolean }[] = [
  { kind: "cart_percent", desc: "ลดเป็น % ของยอดสินค้า (กำหนดเพดานได้)", code: true },
  { kind: "cart_amount", desc: "ลดเป็นจำนวนเงินเมื่อซื้อครบยอด", code: true },
  { kind: "free_shipping", desc: "ยกเว้นค่าส่งเมื่อครบยอด", code: true },
  { kind: "buy_x_get_y", desc: "ซื้อ N ชิ้น แถม/ลดชิ้นถัดไป ต่อรายการ", code: false },
  { kind: "quantity_break", desc: "ราคาต่อชิ้นถูกลงตามจำนวน (ราคาส่ง)", code: false },
  { kind: "group_price", desc: "ลด % ให้กลุ่มลูกค้า เช่น ขายส่ง", code: false },
  { kind: "tier_price", desc: "ลด % ให้ระดับสมาชิก Silver/Gold/Platinum", code: false },
];
type QtyRow = { min_qty: string; mode: "price" | "percent"; value: string };
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function PromotionEditorPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id && params.id !== "new" ? Number(params.id) : null;
  const res = useApi(() => (id ? getPromotion(id) : Promise.resolve(null)), `promo${id}`);
  if (res.error) return <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />;
  if (res.loading && !res.data) return <PageFallback />;
  return <Editor key={`${id ?? "new"}-${res.data?.updated_at ?? ""}`} promo={res.data ?? null} onSaved={(p) => res.mutate(p)} />;
}

function Editor({ promo, onSaved }: { promo: AdminPromotion | null; onSaved: (p: AdminPromotion) => void }) {
  const router = useRouter();
  const sp = useSearchParams();
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const canWrite = can("promotions:write");
  const groups = useApi(listCustomerGroups, "groups", can("customers:read"));
  const camps = useApi(() => listCampaigns(), "camps");
  const presetKind = (sp.get("kind") as PromotionKind | null) ?? (sp.get("mode") === "code" ? "cart_percent" : "cart_amount");
  const [f, setF] = useState(() => {
    const p = promo;
    return {
      name: p?.name ?? "",
      label: p?.label ?? "",
      description: p?.description ?? "",
      kind: (p?.kind ?? presetKind) as PromotionKind,
      withCode: p ? p.layer === 4 : sp.get("mode") === "code",
      status: p?.status ?? "draft",
      percent: bpToInput(p?.percent_bp),
      amount: satangToInput(p?.amount_satang),
      buy_qty: p?.buy_qty ? String(p.buy_qty) : "2",
      get_qty: p?.get_qty ? String(p.get_qty) : "1",
      get_percent: p?.get_percent_bp && p.get_percent_bp !== 10000 ? bpToInput(p.get_percent_bp) : "",
      min_spend: p && p.min_spend_satang ? satangToInput(p.min_spend_satang) : "",
      max_discount: satangToInput(p?.max_discount_satang),
      usage_limit: p?.usage_limit ? String(p.usage_limit) : "",
      per_customer_limit: p?.per_customer_limit ? String(p.per_customer_limit) : "",
      priority: String(p?.priority ?? 0),
      starts_at: toBkkInput(p?.starts_at ?? nowIso()),
      ends_at: toBkkInput(p?.ends_at),
      exclusive: p?.exclusive ?? false,
      codes: "",
      campaign_id: p?.campaign ? String(p.campaign.id) : sp.get("campaign") ?? "",
      season_tag: p?.season_tag ?? "",
    };
  });
  const [groupIds, setGroupIds] = useState<number[]>(promo?.customer_group_ids ?? (sp.get("group") ? [Number(sp.get("group"))] : []));
  const [tiers, setTiers] = useState<Tier[]>(promo?.tiers ?? []);
  const [targets, setTargets] = useState<PickedTarget[]>(promo?.targets ?? []);
  const [qty, setQty] = useState<QtyRow[]>(() =>
    promo?.qty_tiers.length
      ? promo.qty_tiers.map((t) => (t.unit_price_satang !== null ? { min_qty: String(t.min_qty), mode: "price" as const, value: satangToInput(t.unit_price_satang) } : { min_qty: String(t.min_qty), mode: "percent" as const, value: bpToInput(t.percent_bp) }))
      : [
          { min_qty: "5", mode: "percent", value: "5" },
          { min_qty: "10", mode: "percent", value: "10" },
          { min_qty: "50", mode: "percent", value: "15" },
        ],
  );
  const [codes, setCodes] = useState(promo?.codes ?? []);
  const [newCode, setNewCode] = useState("");
  const [gen, setGen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const upd = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const kindInfo = KINDS.find((k) => k.kind === f.kind)!;
  const withCode = kindInfo.code && f.withCode;
  const layer = deriveLayer(f.kind, withCode);
  const isPercent = f.kind === "cart_percent" || f.kind === "group_price" || f.kind === "tier_price";

  function buildBody(): PromotionInput | null {
    const v = validate(promotionSchema, { ...f, withCode });
    const errs: Record<string, string> = v.ok ? {} : { ...v.errors };
    let qty_tiers: AdminPromotion["qty_tiers"] = [];
    if (f.kind === "quantity_break") {
      qty_tiers = qty.map((r) => ({ min_qty: Number(r.min_qty), unit_price_satang: r.mode === "price" ? parseBahtToSatang(r.value) : null, percent_bp: r.mode === "percent" ? parsePercentToBp(r.value) : null }));
      if (!qty_tiers.length) errs.qty = "ต้องมีอย่างน้อย 1 ขั้น";
      if (qty_tiers.some((t, i) => !Number.isInteger(t.min_qty) || t.min_qty < 2 || (qty[i].mode === "price" ? !t.unit_price_satang : !t.percent_bp))) errs.qty = "ตรวจสอบจำนวนขั้นต่ำ (≥ 2) และราคา/เปอร์เซ็นต์ทุกขั้น";
      if (new Set(qty_tiers.map((t) => t.min_qty)).size !== qty_tiers.length) errs.qty = "จำนวนขั้นต่ำซ้ำกัน";
    }
    if (f.kind === "group_price" && groupIds.length === 0) errs.audience = "เลือกกลุ่มลูกค้าอย่างน้อย 1 กลุ่ม";
    if (f.kind === "tier_price" && tiers.length === 0) errs.audience = "เลือกระดับสมาชิกอย่างน้อย 1 ระดับ";
    if (!promo && withCode && !f.codes.trim()) errs.codes = "กรอกโค้ดอย่างน้อย 1 โค้ด (หรือสร้างจำนวนมากหลังบันทึก)";
    if (Object.keys(errs).length) {
      setErrors(errs);
      toast("กรุณาตรวจสอบข้อมูลที่ไฮไลต์", "error");
      return null;
    }
    setErrors({});
    const money = (s: string) => (s.trim() ? parseBahtToSatang(s) : null);
    return {
      name: f.name.trim(),
      label: f.label.trim(),
      description: f.description,
      kind: f.kind,
      status: f.status,
      auto_apply: !withCode,
      exclusive: withCode ? f.exclusive : false,
      starts_at: fromBkkInput(f.starts_at)!,
      ends_at: fromBkkInput(f.ends_at),
      priority: Number(f.priority),
      percent_bp: isPercent ? parsePercentToBp(f.percent) : null,
      amount_satang: f.kind === "cart_amount" ? money(f.amount) : null,
      buy_qty: f.kind === "buy_x_get_y" ? Number(f.buy_qty) : null,
      get_qty: f.kind === "buy_x_get_y" ? Number(f.get_qty) : null,
      get_percent_bp: f.kind === "buy_x_get_y" ? (f.get_percent.trim() ? parsePercentToBp(f.get_percent) : 10000) : null,
      min_spend_satang: money(f.min_spend) ?? 0,
      max_discount_satang: f.kind === "cart_percent" || f.kind === "free_shipping" ? money(f.max_discount) : null,
      usage_limit: f.usage_limit ? Number(f.usage_limit) : null,
      per_customer_limit: f.per_customer_limit ? Number(f.per_customer_limit) : null,
      customer_group_ids: groupIds,
      tiers,
      qty_tiers,
      targets: targets.map(({ type, id }) => ({ type, id })),
      campaign_id: f.campaign_id ? Number(f.campaign_id) : null,
      season_tag: f.season_tag,
      ...(promo ? {} : { codes: withCode ? f.codes.split(/[\s,]+/).filter(Boolean).map(normalizeCode) : [] }),
    };
  }

  async function save(status?: AdminPromotion["status"]) {
    const body = buildBody();
    if (!body) return;
    if (status) body.status = status;
    setBusy(true);
    try {
      if (promo) {
        const p = await updatePromotion(promo.id, body);
        toast("บันทึกโปรโมชันแล้ว");
        onSaved(p);
      } else {
        const p = await createPromotion(body);
        toast("สร้างโปรโมชันแล้ว");
        router.replace(`/admin/promotions/${p.id}`);
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!promo) return;
    if (!(await confirm({ title: `ลบ “${promo.name}”?`, body: promo.used_count ? "มีการใช้แล้ว ระบบจะเก็บถาวรแทน" : "ลบแล้วกู้คืนไม่ได้", confirmLabel: "ลบ", danger: true }))) return;
    try {
      await deletePromotion(promo.id);
      toast("ลบแล้ว");
      router.replace("/admin/promotions");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function addCode() {
    const c = normalizeCode(newCode);
    if (!/^[A-Z0-9_-]{3,32}$/.test(c) || !promo) return toast("โค้ดใช้ A-Z, 0-9 ยาว 3–32 ตัว", "error");
    try {
      const added = await addCodes(promo.id, { codes: [c] });
      setCodes((x) => [...x, ...added]);
      setNewCode("");
      toast(`เพิ่มโค้ด ${c} แล้ว`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function killCode(id: number, code: string) {
    if (!(await confirm({ title: `ปิดโค้ด ${code}?`, body: "ลูกค้าจะใช้โค้ดนี้ไม่ได้อีก (ประวัติการใช้ยังอยู่)", confirmLabel: "ปิดโค้ด", danger: true }))) return;
    try {
      await deactivateCode(id);
      setCodes((x) => x.map((c) => (c.id === id ? { ...c, is_active: false } : c)));
      toast("ปิดโค้ดแล้ว");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const draftPreview = {
    kind: f.kind,
    percent_bp: parsePercentToBp(f.percent),
    amount_satang: parseBahtToSatang(f.amount),
    buy_qty: Number(f.buy_qty) || 0,
    get_qty: Number(f.get_qty) || 0,
    get_percent_bp: f.get_percent ? parsePercentToBp(f.get_percent) : 10000,
    min_spend_satang: parseBahtToSatang(f.min_spend) ?? 0,
    max_discount_satang: f.max_discount ? parseBahtToSatang(f.max_discount) : null,
    qty_tiers: qty.map((r) => ({ min_qty: Number(r.min_qty), unit_price_satang: r.mode === "price" ? parseBahtToSatang(r.value) : null, percent_bp: r.mode === "percent" ? parsePercentToBp(r.value) : null })),
  };
  const firstCode = codes.find((c) => c.is_active)?.code ?? f.codes.split(/[\s,]+/).filter(Boolean)[0];

  return (
    <div>
      <PageHeader
        back={{ href: "/admin/promotions", label: "โปรโมชัน" }}
        title={promo ? promo.name : withCode ? "สร้างโค้ดส่วนลด" : "สร้างโปรโมชัน"}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {promo ? <PromoStateBadge state={promo.state} /> : null}
            <Badge tone="blue">{LAYER_LABEL[layer]}</Badge>
            {promo ? <span>ใช้ไป {promo.used_count} ครั้ง</span> : null}
          </span>
        }
        actions={promo && canWrite ? <Button variant="danger-ghost" icon={Trash2} onClick={remove}>ลบ</Button> : null}
      />
      <fieldset disabled={!canWrite} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="ประเภทส่วนลด">
            <div className="grid gap-2 sm:grid-cols-2">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  disabled={Boolean(promo)}
                  onClick={() => upd("kind", k.kind)}
                  className={`rounded-[10px] border p-3 text-left transition-colors disabled:cursor-default ${f.kind === k.kind ? "border-accent bg-accent-soft" : "border-hairline-soft hover:border-hairline disabled:opacity-50"}`}
                >
                  <span className="block text-sm font-medium text-ink">{PROMO_KIND_LABEL[k.kind]}</span>
                  <span className="text-xs text-ink-2">{k.desc}</span>
                </button>
              ))}
            </div>
            {kindInfo.code ? (
              <div className="mt-4 rounded-[10px] bg-canvas-alt p-3">
                <Switch
                  checked={!f.withCode}
                  onChange={(v) => upd("withCode", !v)}
                  disabled={Boolean(promo)}
                  label="ใช้อัตโนมัติ (ไม่ต้องกรอกโค้ด)"
                  description={f.withCode ? "ลูกค้าต้องกรอกโค้ดตอนชำระเงิน · 1 ตะกร้าใช้ได้ 1 โค้ด" : "ระบบเลือกโปรอัตโนมัติที่คุ้มที่สุดให้ลูกค้า 1 โปร"}
                />
              </div>
            ) : null}
            {promo ? <p className="mt-2 text-xs text-ink-2">เปลี่ยนประเภทหลังสร้างไม่ได้ (สร้างใหม่แทน)</p> : null}
          </Card>

          <Card title="รายละเอียด">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ชื่อ (ภายใน)" required error={errors.name}>
                <Input value={f.name} onChange={(e) => upd("name", e.target.value)} invalid={Boolean(errors.name)} placeholder="เช่น โค้ด 12.12 ลด 12%" />
              </Field>
              <Field label="ข้อความที่ลูกค้าเห็น" required error={errors.label} hint="แสดงในตะกร้าและใบเสร็จ">
                <Input value={f.label} onChange={(e) => upd("label", e.target.value)} invalid={Boolean(errors.label)} placeholder="เช่น โค้ด 1212 ลด 12%" />
              </Field>

              {isPercent ? (
                <Field label="ส่วนลด" required error={errors.percent}>
                  <PercentInput value={f.percent} onChange={(v) => upd("percent", v)} invalid={Boolean(errors.percent)} placeholder="10" />
                </Field>
              ) : null}
              {f.kind === "cart_amount" ? (
                <Field label="ลดเป็นเงิน" required error={errors.amount}>
                  <MoneyInput value={f.amount} onChange={(v) => upd("amount", v)} invalid={Boolean(errors.amount)} placeholder="100" />
                </Field>
              ) : null}
              {f.kind === "cart_percent" || f.kind === "free_shipping" ? (
                <Field label={f.kind === "free_shipping" ? "ลดค่าส่งไม่เกิน" : "ลดสูงสุด"} error={errors.max_discount} hint="เว้นว่าง = ไม่จำกัด">
                  <MoneyInput value={f.max_discount} onChange={(v) => upd("max_discount", v)} invalid={Boolean(errors.max_discount)} />
                </Field>
              ) : null}
              {f.kind === "buy_x_get_y" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="ซื้อ (ชิ้น)" required error={errors.buy_qty}>
                      <IntInput value={f.buy_qty} onChange={(v) => upd("buy_qty", v)} invalid={Boolean(errors.buy_qty)} />
                    </Field>
                    <Field label="แถม (ชิ้น)" required error={errors.get_qty}>
                      <IntInput value={f.get_qty} onChange={(v) => upd("get_qty", v)} invalid={Boolean(errors.get_qty)} />
                    </Field>
                  </div>
                  <Field label="ชิ้นที่แถมลด" error={errors.get_percent} hint="เว้นว่าง = ฟรี 100%">
                    <PercentInput value={f.get_percent} onChange={(v) => upd("get_percent", v)} invalid={Boolean(errors.get_percent)} placeholder="100" />
                  </Field>
                </>
              ) : null}
              {f.kind === "quantity_break" ? (
                <div className="sm:col-span-2">
                  <p className="mb-1 text-[13px] font-medium text-ink">ขั้นราคา</p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr className="text-left text-xs text-ink-2">
                          <th className="py-1 font-medium">ซื้อตั้งแต่ (ชิ้น)</th>
                          <th className="py-1 font-medium">แบบ</th>
                          <th className="py-1 font-medium">ราคาต่อชิ้น / ส่วนลด</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {qty.map((r, i) => {
                          const set = (p: Partial<QtyRow>) => setQty((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
                          return (
                            <tr key={i}>
                              <td className="py-1 pr-2">
                                <IntInput value={r.min_qty} onChange={(v) => set({ min_qty: v })} className="w-24" aria-label="จำนวนขั้นต่ำ" />
                              </td>
                              <td className="py-1 pr-2">
                                <Select value={r.mode} onChange={(e) => set({ mode: e.target.value as QtyRow["mode"], value: "" })} className="w-28" aria-label="แบบ">
                                  <option value="price">฿/ชิ้น</option>
                                  <option value="percent">ลด %</option>
                                </Select>
                              </td>
                              <td className="py-1 pr-2">{r.mode === "price" ? <MoneyInput value={r.value} onChange={(v) => set({ value: v })} aria-label="ราคา" /> : <PercentInput value={r.value} onChange={(v) => set({ value: v })} aria-label="ส่วนลด" />}</td>
                              <td>
                                <IconButton size="sm" label="ลบขั้น" icon={X} onClick={() => setQty((xs) => xs.filter((_, j) => j !== i))} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {errors.qty ? <p className="text-xs text-danger">{errors.qty}</p> : null}
                  <Button size="sm" variant="ghost" icon={Plus} onClick={() => setQty((xs) => [...xs, { min_qty: String((Number(xs[xs.length - 1]?.min_qty) || 2) * 2), mode: xs[xs.length - 1]?.mode ?? "percent", value: "" }])}>
                    เพิ่มขั้น
                  </Button>
                </div>
              ) : null}
              <Field label="คำอธิบาย (ภายใน)" className="sm:col-span-2">
                <Textarea rows={2} value={f.description} onChange={(e) => upd("description", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card title="เงื่อนไข">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {f.kind !== "quantity_break" && f.kind !== "group_price" && f.kind !== "tier_price" && f.kind !== "buy_x_get_y" ? (
                <Field label="ยอดซื้อขั้นต่ำ" error={errors.min_spend} hint="คิดจากยอดสินค้าที่ร่วมรายการ">
                  <MoneyInput value={f.min_spend} onChange={(v) => upd("min_spend", v)} invalid={Boolean(errors.min_spend)} placeholder="0" />
                </Field>
              ) : null}
              <Field label="จำนวนสิทธิ์ทั้งหมด" error={errors.usage_limit} hint="เว้นว่าง = ไม่จำกัด">
                <IntInput value={f.usage_limit} onChange={(v) => upd("usage_limit", v)} invalid={Boolean(errors.usage_limit)} />
              </Field>
              <Field label="สิทธิ์ต่อลูกค้า" error={errors.per_customer_limit} hint="ต้องเข้าสู่ระบบจึงใช้ได้">
                <IntInput value={f.per_customer_limit} onChange={(v) => upd("per_customer_limit", v)} invalid={Boolean(errors.per_customer_limit)} />
              </Field>
              <Field label="เริ่ม (เวลาไทย)" required error={errors.starts_at}>
                <Input type="datetime-local" value={f.starts_at} onChange={(e) => upd("starts_at", e.target.value)} invalid={Boolean(errors.starts_at)} />
              </Field>
              <Field label="สิ้นสุด (เวลาไทย)" error={errors.ends_at} hint="เว้นว่าง = ไม่มีกำหนด">
                <Input type="datetime-local" value={f.ends_at} onChange={(e) => upd("ends_at", e.target.value)} invalid={Boolean(errors.ends_at)} />
              </Field>
              <Field label="ลำดับความสำคัญ" error={errors.priority} hint="ถ้าคุ้มเท่ากัน ใช้ค่ามากกว่า">
                <IntInput value={f.priority} onChange={(v) => upd("priority", v)} invalid={Boolean(errors.priority)} />
              </Field>
            </div>
            {withCode ? (
              <div className="mt-4 rounded-[10px] border border-hairline-soft p-3">
                <Switch checked={f.exclusive} onChange={(v) => upd("exclusive", v)} label="ใช้ร่วมกับโปรอัตโนมัติไม่ได้ (exclusive)" description="ระบบเทียบกับส่วนลดตะกร้าอัตโนมัติ แล้วใช้อันที่คุ้มกว่าให้ลูกค้า" />
              </div>
            ) : null}
          </Card>

          <Card title="กลุ่มเป้าหมาย">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink">กลุ่มลูกค้า</p>
                <div className="flex flex-col gap-2">
                  {(groups.data?.data ?? []).map((g) => (
                    <Checkbox key={g.id} checked={groupIds.includes(g.id)} onChange={(v) => setGroupIds((x) => (v ? [...x, g.id] : x.filter((y) => y !== g.id)))} label={`${g.name} (${g.member_count})`} />
                  ))}
                  {!can("customers:read") ? <p className="text-xs text-ink-2">ไม่มีสิทธิ์ดูกลุ่มลูกค้า</p> : null}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink">ระดับสมาชิก</p>
                <div className="flex flex-col gap-2">
                  {(["standard", "silver", "gold", "platinum"] as Tier[]).map((t) => (
                    <Checkbox key={t} checked={tiers.includes(t)} onChange={(v) => setTiers((x) => (v ? [...x, t] : x.filter((y) => y !== t)))} label={TIER_LABEL[t]} />
                  ))}
                </div>
              </div>
            </div>
            <p className={`mt-3 text-xs ${errors.audience ? "text-danger" : "text-ink-2"}`}>{errors.audience ?? "ไม่เลือกเลย = ลูกค้าทุกคน (รวมผู้ไม่ได้เข้าสู่ระบบ เว้นแต่ราคาส่ง/สมาชิก/จำกัดต่อคน ที่ต้องเข้าสู่ระบบ)"}</p>
          </Card>

          <Card title="สินค้าที่ร่วมรายการ" actions={canWrite ? <Button size="sm" variant="outline" icon={Tag} onClick={() => setTargetOpen(true)}>เลือก</Button> : null}>
            {targets.length === 0 ? (
              <p className="text-sm text-ink-2">ทั้งร้าน (ทุกสินค้า)</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {targets.map((t) => (
                  <span key={`${t.type}${t.id}`} className="inline-flex h-8 items-center gap-1 rounded-full bg-canvas-alt pl-3 pr-1 text-[13px]">
                    <span className="text-ink-2">{t.type === "category" ? "หมวด" : t.type === "product" ? "สินค้า" : "ตัวเลือก"}:</span> {t.name}
                    <button type="button" aria-label={`นำ ${t.name} ออก`} onClick={() => setTargets((x) => x.filter((y) => !(y.type === t.type && y.id === t.id)))} className="flex size-6 items-center justify-center rounded-full text-ink-2 hover:bg-hairline-soft">
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Card>

          {withCode ? (
            <Card
              title={`โค้ด (${promo ? codes.length : f.codes.split(/[\s,]+/).filter(Boolean).length})`}
              actions={promo && canWrite ? <Button size="sm" variant="outline" icon={Wand2} onClick={() => setGen(true)}>สร้างจำนวนมาก</Button> : null}
            >
              {promo ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {codes.map((c) => (
                      <span key={c.id} className={`inline-flex h-8 items-center gap-1 rounded-[8px] border px-2 font-mono text-[13px] ${c.is_active ? "border-hairline-soft text-ink" : "border-transparent bg-canvas-alt text-ink-3 line-through"}`}>
                        {c.code}
                        {c.is_active && canWrite ? (
                          <button type="button" aria-label={`ปิดโค้ด ${c.code}`} onClick={() => killCode(c.id, c.code)} className="flex size-6 items-center justify-center rounded text-ink-2 hover:bg-canvas-alt">
                            <X className="size-3.5" aria-hidden />
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                  {canWrite ? (
                    <div className="mt-3 flex max-w-sm gap-2">
                      <Input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="เพิ่มโค้ด" className="font-mono" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCode())} aria-label="โค้ดใหม่" />
                      <Button onClick={addCode}>เพิ่ม</Button>
                    </div>
                  ) : null}
                </>
              ) : (
                <Field error={errors.codes} hint="หลายโค้ดคั่นด้วยเว้นวรรคหรือจุลภาค · สร้างแบบสุ่มจำนวนมากได้หลังบันทึก">
                  <Textarea rows={2} value={f.codes} onChange={(e) => upd("codes", e.target.value.toUpperCase())} invalid={Boolean(errors.codes)} placeholder="SAVE12 WELCOME50" className="font-mono" />
                </Field>
              )}
            </Card>
          ) : null}
          {promo && promo.used_count > 0 ? <Redemptions id={promo.id} /> : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card title="สรุป" className="lg:sticky lg:top-20">
            <p className="text-lg font-semibold text-ink">{f.label || "ข้อความที่ลูกค้าเห็น"}</p>
            <p className="mt-1 text-sm text-ink-2">{promoValue(draftPreview as Parameters<typeof promoValue>[0])}</p>
            <ul className="mt-3 space-y-1.5 text-[13px] text-ink-2">
              <li>• {LAYER_LABEL[layer]}</li>
              <li>• {withCode ? `ต้องใช้โค้ด${firstCode ? ` ${firstCode}` : ""}` : "ใช้อัตโนมัติ"}</li>
              <li>• {targets.length ? `${targets.length} รายการที่ร่วม` : "ทั้งร้าน"}</li>
              <li>• {groupIds.length || tiers.length ? "เฉพาะกลุ่ม/ระดับที่เลือก" : "ลูกค้าทุกคน"}</li>
              {f.usage_limit ? <li>• สิทธิ์ทั้งหมด {f.usage_limit} ครั้ง</li> : null}
              {f.per_customer_limit ? <li>• คนละ {f.per_customer_limit} ครั้ง</li> : null}
            </ul>
            <div className="mt-4 border-t border-hairline-soft pt-4">
              <Field label="สถานะ">
                <Segmented
                  value={f.status === "archived" ? "paused" : f.status}
                  onChange={(v) => upd("status", v)}
                  options={[
                    { value: "draft", label: "ร่าง" },
                    { value: "active", label: "เปิดใช้" },
                    { value: "paused", label: "หยุด" },
                  ]}
                  className="w-full [&>button]:flex-1"
                />
              </Field>
              <Field label="แคมเปญ" className="mt-3">
                <Select value={f.campaign_id} onChange={(e) => {
                  const c = (camps.data?.data ?? []).find((x) => String(x.id) === e.target.value);
                  setF((x) => ({ ...x, campaign_id: e.target.value, season_tag: c?.season_tag ?? x.season_tag }));
                }}>
                  <option value="">— ไม่ผูกแคมเปญ —</option>
                  {(camps.data?.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-[10px] bg-accent-soft p-3 text-[13px]">
              <Info className="mt-0.5 size-4 shrink-0 text-link" aria-hidden />
              <span>
                ทดสอบการซ้อนส่วนลดก่อนเปิดใช้จริง{" "}
                <Link href={`/admin/promotions?tab=simulator${firstCode ? `&code=${encodeURIComponent(firstCode)}` : ""}`} className="inline-flex items-center gap-1 font-medium text-link hover:underline">
                  <FlaskConical className="size-3.5" aria-hidden /> จำลองตะกร้า
                </Link>
              </span>
            </div>
            {promo ? <p className="mt-3 text-xs text-ink-2">แก้ไขล่าสุด {fmtDateTime(promo.updated_at)}</p> : null}
          </Card>
        </div>
      </fieldset>
      {canWrite ? (
        <div className="pb-safe sticky bottom-0 z-30 -mx-3 mt-4 border-t border-hairline-soft bg-surface/90 backdrop-blur-xl sm:-mx-5 md:-mx-6">
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5 md:px-6">
            <Button onClick={() => router.push("/admin/promotions")}>ยกเลิก</Button>
            {!promo ? (
              <Button loading={busy} onClick={() => save("draft")}>
                บันทึกร่าง
              </Button>
            ) : null}
            <Button variant="primary" loading={busy} onClick={() => save(promo ? undefined : "active")}>
              {promo ? "บันทึก" : "บันทึกและเปิดใช้"}
            </Button>
          </div>
        </div>
      ) : null}
      <TargetPicker open={targetOpen} onClose={() => setTargetOpen(false)} value={targets} onChange={setTargets} />
      {gen && promo ? <CodeGenerator promo={{ ...promo, codes }} onClose={() => setGen(false)} onDone={(c) => setCodes((x) => [...x, ...c])} /> : null}
    </div>
  );
}

function Redemptions({ id }: { id: number }) {
  const [page, setPage] = useState(1);
  const res = useApi(() => listRedemptions(id, page), `red${id}-${page}`);
  return (
    <Card title="ประวัติการใช้" pad={false}>
      <ul className="divide-y divide-hairline-soft text-sm">
        {(res.data?.data ?? []).map((r, i) => (
          <li key={`${r.order_no}${i}`} className="flex items-center gap-3 px-4 py-2">
            <Link href={`/admin/orders/${r.order_no}`} className="w-32 font-medium tabular-nums text-ink hover:text-link">
              {r.order_no}
            </Link>
            <span className="min-w-0 flex-1 truncate text-ink-2">{r.user_email}</span>
            <Badge tone={r.status === "confirmed" ? "green" : r.status === "released" ? "neutral" : "blue"}>{r.status === "confirmed" ? "ยืนยัน" : r.status === "released" ? "คืนสิทธิ์" : "จองไว้"}</Badge>
            <span className="w-20 text-right tabular-nums">{formatBaht(r.amount_satang)}</span>
          </li>
        ))}
      </ul>
      {res.data ? <Pagination page={res.data.meta.page} totalPages={res.data.meta.total_pages} total={res.data.meta.total} onPage={setPage} /> : null}
    </Card>
  );
}
