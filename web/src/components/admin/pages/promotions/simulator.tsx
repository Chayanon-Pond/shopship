"use client";

import { AlertCircle, CheckCircle2, FlaskConical, Lightbulb, Minus, Plus, RotateCcw, Trash2, Truck, User, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { formatBaht, formatDiscount } from "@/lib/money";
import { listCustomerGroups, listUsers, previewPromotions, type AdminUser } from "@/lib/api/admin";
import { USE_MOCKS } from "@/lib/api/client";
import { getProduct as getPublicProduct } from "@/lib/api/storefront";
import type { Quote, Tier } from "@/lib/api/types";
import { useApi } from "@/lib/admin/hooks";
import { fromBkkInput, TIER_LABEL, toBkkInput } from "@/lib/admin/format";
import { LAYER_LABEL } from "@/lib/admin/promo";
import { errorMessage, useToast } from "../../overlay";
import { UserPicker, VariantPicker, type PickedVariant } from "../../pickers";
import { useSession } from "../../session";
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Segmented, Select } from "../../ui";

type Line = PickedVariant & { qty: number };
type Audience = "guest" | "group" | "tier" | "user";
const SOURCE_LABEL = { list: "ราคาปกติ", flash_sale: "Flash Sale", quantity_break: "ราคาตามจำนวน", group_price: "ราคากลุ่ม", tier_price: "ราคาสมาชิก" } as const;
const MOCK_PRESETS: { name: string; lines: Omit<Line, "stock" | "image_url">[]; code?: string; audience?: Audience }[] = [
  { name: "ขายส่ง + TRADE5 + ส่งฟรี", code: "TRADE5", audience: "group", lines: [{ variant_id: 101, sku: "TOTE-NAT", product_id: 11, product_name: "ถุงผ้าแคนวาส", variant_name: "สีธรรมชาติ", price_satang: 25000, qty: 12 }, { variant_id: 205, sku: "LIN-WHT-M", product_id: 12, product_name: "เสื้อเชิ้ตลินิน", variant_name: "ขาว / M", price_satang: 59000, qty: 1 }] },
  { name: "Exclusive แพ้โปรอัตโนมัติ", code: "SAVE10X", lines: [{ variant_id: 301, sku: "EAR-PRO-WHT", product_id: 13, product_name: "หูฟังไร้สาย Pro", variant_name: "ขาว", price_satang: 120000, qty: 1 }] },
  { name: "Flash + ซื้อ 2 แถม 1", lines: [{ variant_id: 401, sku: "SW-LITE-BLK", product_id: 14, product_name: "สมาร์ทวอทช์ Lite", variant_name: "ดำ", price_satang: 89000, qty: 1 }, { variant_id: 502, sku: "SOCK-WHT-F", product_id: 15, product_name: "ถุงเท้าคอตตอน", variant_name: "ขาว / ฟรีไซซ์", price_satang: 9900, qty: 3 }] },
];

/** Real-stack presets reference the demo seed by product slug (resolved at click time; ids differ per database). */
type Preset = { name: string; code?: string; audience?: Audience; group?: string; items?: { slug: string; qty: number }[]; lines?: Omit<Line, "stock" | "image_url">[] };
const SEED_PRESETS: Preset[] = [
  { name: "ขายส่ง 12 ชิ้น + ส่งฟรี", audience: "group", group: "wholesale", items: [{ slug: "canvas-tote-bag", qty: 12 }, { slug: "cotton-tee-classic", qty: 1 }] },
  { name: "1111SALE เทียบโปรช้อปครบ", code: "1111SALE", items: [{ slug: "camping-tent-2p", qty: 1 }] },
  { name: "Flash + ซื้อ 2 แถม 1", items: [{ slug: "camping-chair", qty: 1 }, { slug: "cashew-honey-roasted", qty: 3 }] },
];
const PRESETS: Preset[] = USE_MOCKS ? MOCK_PRESETS : SEED_PRESETS;

export function SimulatorTab() {
  const sp = useSearchParams();
  const { can } = useSession();
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>([]);
  const [code, setCode] = useState(sp.get("code") ?? "");
  const [audience, setAudience] = useState<Audience>("guest");
  const [groupId, setGroupId] = useState("");
  const [tier, setTier] = useState<Tier>("gold");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [when, setWhen] = useState(() => toBkkInput(new Date().toISOString()));
  const [postal, setPostal] = useState("10110");
  const [picker, setPicker] = useState(false);
  const [userPicker, setUserPicker] = useState(false);
  const [quote, setQuote] = useState<{ q: Quote; who: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const groups = useApi(listCustomerGroups, "groups", can("customers:read"));

  async function resolveUser(): Promise<{ id?: number; who: string } | null> {
    if (audience === "guest") return { who: "ผู้เยี่ยมชม (ไม่ได้เข้าสู่ระบบ)" };
    if (audience === "user") return user ? { id: user.id, who: user.name } : null;
    const r = await listUsers(audience === "group" ? { role: "customer", group_id: Number(groupId), per_page: 1 } : { role: "customer", tier, per_page: 1 });
    const u = r.data[0];
    if (!u) {
      setErr(audience === "group" ? "กลุ่มนี้ยังไม่มีสมาชิก — เพิ่มลูกค้าเข้ากลุ่มก่อน" : `ยังไม่มีลูกค้าระดับ ${TIER_LABEL[tier]}`);
      return null;
    }
    return { id: u.id, who: `${u.name} (${audience === "group" ? u.group?.name : TIER_LABEL[u.tier]})` };
  }
  async function run() {
    setErr("");
    if (!lines.length) return setErr("เพิ่มสินค้าในตะกร้าก่อน");
    if (audience === "group" && !groupId) return setErr("เลือกกลุ่มลูกค้า");
    if (audience === "user" && !user) return setErr("เลือกลูกค้า");
    if (postal && !/^[1-9]\d{4}$/.test(postal)) return setErr("รหัสไปรษณีย์ไม่ถูกต้อง");
    setBusy(true);
    try {
      const u = await resolveUser();
      if (!u) return;
      const q = await previewPromotions({ lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty })), coupon_code: code.trim() || undefined, user_id: u.id, postal_code: postal || undefined, now: fromBkkInput(when) ?? undefined });
      setQuote({ q, who: u.who });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function preset(i: number) {
    const p = PRESETS[i];
    setErr("");
    let next: Line[];
    if (p.lines) next = p.lines.map((l) => ({ ...l, stock: 99, image_url: "" }));
    else {
      try {
        next = await Promise.all(
          (p.items ?? []).map(async ({ slug, qty }) => {
            const prod = await getPublicProduct(slug);
            const v = prod.variants.find((x) => x.in_stock) ?? prod.variants[0];
            return { variant_id: v.id, sku: v.sku, product_id: prod.id, product_name: prod.name, variant_name: v.name, price_satang: v.price_satang, stock: 99, image_url: prod.image?.url ?? "", qty };
          }),
        );
      } catch {
        setErr("ไม่พบสินค้าตัวอย่างในร้าน (ข้อมูลเดโมยังไม่ได้ seed?) — เพิ่มสินค้าเองได้");
        return;
      }
    }
    setLines(next);
    setCode(p.code ?? "");
    if (p.audience === "group") {
      setAudience("group");
      const g = USE_MOCKS ? undefined : (groups.data?.data ?? []).find((x) => x.code === p.group);
      setGroupId(g ? String(g.id) : "2");
    } else setAudience("guest");
    setQuote(null);
  }
  const setQty = (i: number, qty: number) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, qty: Math.max(1, Math.min(999, qty)) } : l)));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="ตะกร้าจำลอง" actions={<Button size="sm" variant="outline" icon={Plus} onClick={() => setPicker(true)}>เพิ่มสินค้า</Button>}>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <span className="self-center text-xs text-ink-2">ตัวอย่าง:</span>
            {PRESETS.map((p, i) => (
              <button key={p.name} type="button" onClick={() => void preset(i)} className="h-7 rounded-full border border-hairline-soft px-2.5 text-xs text-ink hover:border-accent hover:text-link">
                {p.name}
              </button>
            ))}
          </div>
          {lines.length === 0 ? (
            <EmptyState icon={FlaskConical} title="ตะกร้าว่าง" body="เพิ่มสินค้าและจำนวน แล้วกด “คำนวณ” เพื่อดูว่าโปรไหนทำงานบ้าง" />
          ) : (
            <ul className="divide-y divide-hairline-soft">
              {lines.map((l, i) => (
                <li key={l.variant_id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{l.product_name}</span>
                    <span className="text-xs text-ink-2">
                      {l.variant_name} · {formatBaht(l.price_satang)}
                    </span>
                  </span>
                  <span className="flex items-center rounded-[10px] border border-hairline">
                    <IconButton size="sm" label="ลด" icon={Minus} onClick={() => setQty(i, l.qty - 1)} />
                    <input value={l.qty} onChange={(e) => setQty(i, Number(e.target.value.replace(/\D/g, "")) || 1)} inputMode="numeric" className="w-10 bg-transparent text-center text-sm tabular-nums" aria-label="จำนวน" />
                    <IconButton size="sm" label="เพิ่ม" icon={Plus} onClick={() => setQty(i, l.qty + 1)} />
                  </span>
                  <IconButton size="sm" label="นำออก" icon={Trash2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="ลูกค้าและสถานการณ์">
          <div className="grid gap-4">
            <Field label="ลูกค้า">
              <Segmented
                value={audience}
                onChange={setAudience}
                options={[
                  { value: "guest", label: "ผู้เยี่ยมชม" },
                  { value: "group", label: "ตามกลุ่ม" },
                  { value: "tier", label: "ตามระดับ" },
                  { value: "user", label: "ระบุคน" },
                ]}
                className="w-full [&>button]:flex-1"
              />
            </Field>
            {audience === "group" ? (
              <Field label="กลุ่มลูกค้า" hint="ใช้สมาชิกคนแรกของกลุ่มเป็นตัวแทน">
                <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">เลือกกลุ่ม</option>
                  {(groups.data?.data ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.member_count})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : audience === "tier" ? (
              <Field label="ระดับสมาชิก" hint="ใช้ลูกค้าคนแรกในระดับนั้นเป็นตัวแทน">
                <Segmented value={tier} onChange={setTier} options={(["standard", "silver", "gold", "platinum"] as Tier[]).map((t) => ({ value: t, label: TIER_LABEL[t] }))} className="w-full [&>button]:flex-1" />
              </Field>
            ) : audience === "user" ? (
              <Button icon={User} onClick={() => setUserPicker(true)} className="justify-start">
                {user ? `${user.name} · ${user.email}` : "เลือกลูกค้า…"}
              </Button>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="โค้ดส่วนลด">
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ไม่มี" className="font-mono" />
              </Field>
              <Field label="วันเวลา (ไทย)" hint="ลองล่วงหน้าได้ เช่น 12.12">
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </Field>
              <Field label="รหัสไปรษณีย์" hint="ว่าง = ยังไม่คิดค่าส่ง">
                <Input value={postal} onChange={(e) => setPostal(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" />
              </Field>
            </div>
            {err ? (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
                <AlertCircle className="size-4" aria-hidden /> {err}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button variant="primary" size="lg" icon={FlaskConical} loading={busy} onClick={run} className="flex-1">
                คำนวณ
              </Button>
              <IconButton label="ล้างทั้งหมด" icon={RotateCcw} onClick={() => (setLines([]), setQuote(null), setCode(""))} className="size-14" />
            </div>
          </div>
        </Card>
      </div>

      <div className="min-w-0">{quote ? <QuoteView quote={quote.q} who={quote.who} lines={lines} /> : <Card><EmptyState icon={FlaskConical} title="ผลการคำนวณจะแสดงที่นี่" body="ระบบใช้กฎเดียวกับหน้าร้าน (รวมโปรที่ยังเป็นฉบับร่าง) เพื่อให้ตรวจการซ้อนส่วนลดก่อนเปิดใช้" /></Card>}</div>

      <VariantPicker
        open={picker}
        onClose={() => setPicker(false)}
        picked={new Set(lines.map((l) => l.variant_id))}
        onPick={(v) => setLines((ls) => (ls.some((l) => l.variant_id === v.variant_id) ? ls.map((l) => (l.variant_id === v.variant_id ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { ...v, qty: 1 }]))}
      />
      <UserPicker open={userPicker} onClose={() => setUserPicker(false)} onPick={(u) => (setUser(u), setUserPicker(false))} />
    </div>
  );
}

function QuoteView({ quote, who, lines }: { quote: Quote; who: string; lines: Line[] }) {
  const name = (vid: number) => {
    const l = lines.find((x) => x.variant_id === vid);
    return l ? `${l.product_name} · ${l.variant_name}` : `#${vid}`;
  };
  const t = quote.totals;
  const layerRows = [1, 2, 3, 4, 5].map((layer) => {
    const items: { label: string; amount: number; note?: string }[] = [];
    if (layer === 1)
      quote.lines
        .filter((l) => l.price_source.kind !== "list")
        .forEach((l) => items.push({ label: `${l.price_source.label || SOURCE_LABEL[l.price_source.kind]} — ${name(l.variant_id)}`, amount: (l.list_unit_price_satang - l.unit_price_satang) * l.qty }));
    if (layer === 2) quote.lines.forEach((l) => l.adjustments.forEach((a) => items.push({ label: `${a.label} — ${name(l.variant_id)}`, amount: a.amount_satang })));
    if (layer === 3 || layer === 4) quote.adjustments.filter((a) => a.layer === layer).forEach((a) => items.push({ label: a.label, amount: a.amount_satang, note: a.coupon_code }));
    if (layer === 5 && quote.shipping.discount_satang > 0) items.push({ label: quote.shipping.label ?? "ส่งฟรี", amount: quote.shipping.discount_satang });
    return { layer, items };
  });
  const c = quote.coupon;
  return (
    <div className="flex flex-col gap-4">
      <Card title="ผลการคำนวณ" actions={<span className="text-xs text-ink-2">{who}</span>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="ราคาปกติรวม" value={formatBaht(t.list_subtotal_satang)} />
          <Metric label="ลูกค้าประหยัด" value={formatBaht(t.savings_satang)} tone="sale" />
          <Metric label="ค่าส่ง" value={t.shipping_satang === 0 && quote.shipping.fee_satang > 0 ? "ฟรี" : formatBaht(t.shipping_satang)} />
          <Metric label="ยอดชำระ" value={formatBaht(t.grand_total_satang)} big />
        </div>
        {c ? (
          <div className={`mt-4 flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-sm ${c.status === "applied" ? "bg-[#e9f6ec] text-success" : c.status === "not_applied" ? "bg-sale-soft text-sale" : "bg-[#fdecee] text-danger"}`}>
            {c.status === "applied" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span>
              <b className="font-mono">{c.code}</b> · {c.status === "applied" ? "ใช้ได้" : c.status === "not_applied" ? "ไม่ถูกนำมาใช้" : "ใช้ไม่ได้"} — {c.message}
              {c.reason_code ? <code className="ml-1 text-xs opacity-80">({c.reason_code})</code> : null}
            </span>
          </div>
        ) : null}
      </Card>

      <Card title="การซ้อนส่วนลด 5 ชั้น" pad={false}>
        <ol className="divide-y divide-hairline-soft">
          {layerRows.map(({ layer, items }) => (
            <li key={layer} className="flex gap-3 px-4 py-3">
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${items.length ? "bg-accent text-white" : "bg-canvas-alt text-ink-3"}`}>{layer}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] font-medium ${items.length ? "text-ink" : "text-ink-3"}`}>{LAYER_LABEL[layer]}</p>
                {items.length === 0 ? (
                  <p className="text-xs text-ink-3">ไม่มีโปรที่เข้าเงื่อนไข</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {items.map((it, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 text-ink">
                          {it.label}
                          {it.note ? <Badge tone="blue" className="ml-1.5 font-mono">{it.note}</Badge> : null}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums text-sale">{formatDiscount(it.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="รายการสินค้า" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-hairline-soft text-left text-xs text-ink-2">
                <th className="px-4 py-2 font-medium">สินค้า</th>
                <th className="px-2 py-2 text-right font-medium">จำนวน</th>
                <th className="px-2 py-2 text-right font-medium">ราคา/ชิ้น</th>
                <th className="px-2 py-2 text-right font-medium">รวม</th>
                <th className="px-4 py-2 text-right font-medium">ส่วนแบ่งส่วนลด</th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((l) => (
                <tr key={l.variant_id} className="border-b border-hairline-soft align-top">
                  <td className="px-4 py-2">
                    <span className="block text-ink">{name(l.variant_id)}</span>
                    <span className="flex flex-wrap gap-1 pt-0.5">
                      <Badge tone={l.price_source.kind === "list" ? "neutral" : l.price_source.kind === "flash_sale" ? "orange" : "purple"}>{l.price_source.label || SOURCE_LABEL[l.price_source.kind]}</Badge>
                      {l.availability.status !== "ok" ? <Badge tone="red">{l.availability.status === "out_of_stock" ? "สินค้าหมด" : l.availability.status === "insufficient_stock" ? `เหลือ ${l.availability.available_qty}` : "ไม่พร้อมขาย"}</Badge> : null}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.qty}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {l.unit_price_satang !== l.list_unit_price_satang ? <span className="price-strike mr-1 text-xs">{formatBaht(l.lowest_30d_satang ?? l.list_unit_price_satang)}</span> : null}
                    {formatBaht(l.unit_price_satang)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatBaht(l.line_total_satang)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{l.allocated_discount_satang ? formatDiscount(l.allocated_discount_satang) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="space-y-1 px-4 py-3 text-sm">
          <Row k="ยอดสินค้า (หลังราคาพิเศษ)" v={formatBaht(t.subtotal_satang)} />
          {quote.adjustments.map((a) => (
            <Row key={`${a.promotion_id}-${a.layer}`} k={a.label} v={formatDiscount(a.amount_satang)} sale />
          ))}
          <Row k={<span className="inline-flex items-center gap-1"><Truck className="size-3.5" aria-hidden />ค่าส่ง</span>} v={quote.shipping.fee_satang ? formatBaht(quote.shipping.fee_satang) : "ยังไม่คิด"} />
          {quote.shipping.discount_satang ? <Row k={quote.shipping.label ?? "ส่วนลดค่าส่ง"} v={formatDiscount(quote.shipping.discount_satang)} sale /> : null}
          <div className="mt-2 flex justify-between border-t border-hairline-soft pt-2 text-base font-semibold">
            <dt>ยอดชำระ</dt>
            <dd className="tabular-nums">{formatBaht(t.grand_total_satang)}</dd>
          </div>
        </dl>
      </Card>

      {quote.hints.length ? (
        <Card title="ข้อความแนะนำที่ลูกค้าจะเห็น">
          <ul className="space-y-1.5">
            {quote.hints.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  {h.message}
                  {h.promotion_id ? (
                    <Link href={`/admin/promotions/${h.promotion_id}`} className="ml-1 text-xs text-link hover:underline">
                      ดูโปร
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
function Metric({ label, value, tone, big }: { label: string; value: string; tone?: "sale"; big?: boolean }) {
  return (
    <div className={`rounded-[10px] p-3 ${big ? "bg-ink text-white" : "bg-canvas-alt"}`}>
      <p className={`text-xs ${big ? "text-white/70" : "text-ink-2"}`}>{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === "sale" ? "text-sale" : ""}`}>{value}</p>
    </div>
  );
}
function Row({ k, v, sale }: { k: React.ReactNode; v: string; sale?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-2">{k}</dt>
      <dd className={`tabular-nums ${sale ? "text-sale" : "text-ink"}`}>{v}</dd>
    </div>
  );
}
