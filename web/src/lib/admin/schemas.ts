/**
 * zod schemas for back-office forms. Form state keeps money/percent as the
 * typed STRING; validation converts with parseBahtToSatang / parsePercentToBp
 * (never floats). Messages are Thai. Owner: admin agent.
 */
import { z } from "zod";
import { parseBahtToSatang } from "../money.ts";
import { parsePercentToBp } from "./format.ts";

export const T = {
  required: "กรุณากรอกข้อมูลนี้",
  money: "กรอกจำนวนเงินให้ถูกต้อง เช่น 199 หรือ 1,250.50",
  moneyPos: "ราคาต้องมากกว่า 0",
  percent: "กรอกเปอร์เซ็นต์ 0–100 (ทศนิยมได้ 2 ตำแหน่ง)",
  int: "กรอกเป็นจำนวนเต็ม",
  intPos: "ต้องเป็นจำนวนเต็มมากกว่า 0",
  slug: "ใช้ได้เฉพาะ a-z, 0-9 และขีด (-)",
  email: "อีเมลไม่ถูกต้อง",
  date: "กรุณาเลือกวันและเวลา",
  range: "วันสิ้นสุดต้องหลังวันเริ่ม",
  color: "สีต้องอยู่ในรูปแบบ #RRGGBB",
  url: "ลิงก์ต้องขึ้นต้นด้วย / หรือ https://",
};

export const moneyStr = (opts: { optional?: boolean; positive?: boolean } = {}) =>
  z.string().superRefine((v, ctx) => {
    if (!v.trim()) {
      if (!opts.optional) ctx.addIssue({ code: "custom", message: T.required });
      return;
    }
    const s = parseBahtToSatang(v);
    if (s === null) ctx.addIssue({ code: "custom", message: T.money });
    else if (opts.positive && s <= 0) ctx.addIssue({ code: "custom", message: T.moneyPos });
  });
export const percentStr = (opts: { optional?: boolean } = {}) =>
  z.string().superRefine((v, ctx) => {
    if (!v.trim()) {
      if (!opts.optional) ctx.addIssue({ code: "custom", message: T.required });
      return;
    }
    const bp = parsePercentToBp(v);
    if (bp === null || bp <= 0) ctx.addIssue({ code: "custom", message: T.percent });
  });
export const intStr = (opts: { optional?: boolean; min?: number; allowNegative?: boolean } = {}) =>
  z.string().superRefine((v, ctx) => {
    if (!v.trim()) {
      if (!opts.optional) ctx.addIssue({ code: "custom", message: T.required });
      return;
    }
    if (!(opts.allowNegative ? /^-?\d{1,9}$/ : /^\d{1,9}$/).test(v.trim())) {
      ctx.addIssue({ code: "custom", message: T.int });
      return;
    }
    if (opts.min !== undefined && Number(v) < opts.min) ctx.addIssue({ code: "custom", message: opts.min > 0 ? T.intPos : `ต้องไม่น้อยกว่า ${opts.min}` });
  });
export const slugStr = (optional = false) =>
  z.string().superRefine((v, ctx) => {
    if (!v) {
      if (!optional) ctx.addIssue({ code: "custom", message: T.required });
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) ctx.addIssue({ code: "custom", message: T.slug });
  });
const req = (max = 200) => z.string().trim().min(1, { error: T.required }).max(max, { error: `ยาวได้ไม่เกิน ${max} ตัวอักษร` });
const opt = (max = 500) => z.string().max(max, { error: `ยาวได้ไม่เกิน ${max} ตัวอักษร` });
const dateStr = z.string().min(1, { error: T.date });
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, { error: T.color });
const link = z.string().refine((v) => v === "" || v.startsWith("/") || v.startsWith("https://"), { error: T.url });

export const loginSchema = z.object({
  email: z.email({ error: T.email }),
  password: z.string().min(8, { error: "รหัสผ่านอย่างน้อย 8 ตัวอักษร" }),
});

export const variantRowSchema = z.object({
  sku: req(64),
  price: moneyStr({ positive: true }),
  stock: intStr({ min: 0 }),
  weight: intStr({ min: 0 }),
});
export const productSchema = z.object({
  name: req(200),
  name_en: opt(200),
  slug: slugStr(true),
  category_id: z.string().min(1, { error: "กรุณาเลือกหมวดหมู่" }),
  seo_title: opt(70),
  seo_description: opt(160),
  variants: z.array(variantRowSchema).min(1, { error: "ต้องมีตัวเลือกสินค้าอย่างน้อย 1 รายการ" }),
});

export const categorySchema = z.object({ name: req(100), slug: slugStr(), sort_order: intStr({ min: 0 }) });

export const adjustSchema = z.object({
  delta: intStr({ allowNegative: true }).refine((v) => Number(v) !== 0, { error: "จำนวนต้องไม่เป็น 0" }),
  reason: req(200),
});

export const promotionSchema = z
  .object({
    name: req(120),
    label: req(120),
    kind: z.string(),
    withCode: z.boolean(),
    percent: z.string(),
    amount: z.string(),
    buy_qty: z.string(),
    get_qty: z.string(),
    get_percent: z.string(),
    min_spend: moneyStr({ optional: true }),
    max_discount: moneyStr({ optional: true }),
    usage_limit: intStr({ optional: true, min: 1 }),
    per_customer_limit: intStr({ optional: true, min: 1 }),
    priority: intStr({ min: 0 }),
    starts_at: dateStr,
    ends_at: z.string(),
    codes: z.string(),
  })
  .superRefine((v, ctx) => {
    const add = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (v.kind === "cart_percent" || v.kind === "group_price" || v.kind === "tier_price") {
      const bp = parsePercentToBp(v.percent);
      if (bp === null || bp <= 0) add("percent", T.percent);
    }
    if (v.kind === "cart_amount") {
      const s = parseBahtToSatang(v.amount);
      if (s === null || s <= 0) add("amount", T.money);
    }
    if (v.kind === "buy_x_get_y") {
      if (!/^\d+$/.test(v.buy_qty) || Number(v.buy_qty) < 1) add("buy_qty", T.intPos);
      if (!/^\d+$/.test(v.get_qty) || Number(v.get_qty) < 1) add("get_qty", T.intPos);
      if (v.get_percent.trim() && parsePercentToBp(v.get_percent) === null) add("get_percent", T.percent);
    }
    if (v.ends_at && v.starts_at && v.ends_at <= v.starts_at) add("ends_at", T.range);
    if (v.withCode && v.codes.trim()) {
      const bad = v.codes
        .split(/[\s,]+/)
        .filter(Boolean)
        .find((c) => !/^[A-Za-z0-9_-]{3,32}$/.test(c));
      if (bad) add("codes", `โค้ด "${bad}" ไม่ถูกต้อง (A-Z, 0-9, 3–32 ตัว)`);
    }
  });

export const qtyTierSchema = z.object({ min_qty: intStr({ min: 2 }), value: z.string() });

export const codeGenSchema = z.object({
  count: intStr({ min: 1 }).refine((v) => Number(v) <= 500, { error: "สร้างได้ไม่เกิน 500 โค้ดต่อครั้ง" }),
  prefix: z.string().regex(/^[A-Za-z0-9]{0,12}$/, { error: "คำนำหน้าใช้ A-Z, 0-9 ไม่เกิน 12 ตัว" }),
  length: intStr({ min: 4 }).refine((v) => Number(v) <= 16, { error: "ความยาว 4–16 ตัว" }),
});

export const campaignSchema = z
  .object({
    name: req(120),
    slug: slugStr(),
    season_tag: opt(40),
    starts_at: dateStr,
    ends_at: dateStr,
    accent: hex,
    accent_contrast: hex,
    background: hex,
    badge_text: opt(20),
    hero_image_url: z.string(),
    priority: intStr({ min: 0 }),
  })
  .refine((v) => v.ends_at > v.starts_at, { path: ["ends_at"], error: T.range });

export const flashSaleSchema = z
  .object({ name: req(120), label: req(120), starts_at: dateStr, ends_at: dateStr })
  .refine((v) => v.ends_at > v.starts_at, { path: ["ends_at"], error: T.range });
export const flashItemSchema = z.object({ sale_price: moneyStr({ positive: true }), qty_limit: intStr({ min: 1 }), per_customer_limit: intStr({ optional: true, min: 1 }) });

export const bannerSchema = z
  .object({
    title: req(120),
    subtitle: opt(200),
    cta_label: opt(40),
    link_url: link,
    image_url: z.string(),
    image_alt: opt(200),
    starts_at: z.string(),
    ends_at: z.string(),
    sort_order: intStr({ min: 0 }),
  })
  .refine((v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at, { path: ["ends_at"], error: T.range });

export const groupSchema = z.object({ code: z.string().regex(/^[a-z0-9_-]{2,32}$/, { error: "รหัสใช้ a-z, 0-9, _ - (2–32 ตัว)" }), name: req(80), description: opt(300) });

/** Flatten zod issues into {"variants.0.sku": "message"} (first message per path). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of error.issues) {
    const k = i.path.map(String).join(".") || "_";
    if (!out[k]) out[k] = i.message;
  }
  return out;
}
export function validate<S extends z.ZodType>(schema: S, value: unknown): { ok: true; data: z.infer<S> } | { ok: false; errors: Record<string, string> } {
  const r = schema.safeParse(value);
  return r.success ? { ok: true, data: r.data } : { ok: false, errors: fieldErrors(r.error) };
}
