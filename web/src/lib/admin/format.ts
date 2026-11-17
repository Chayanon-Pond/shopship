/**
 * Pure helpers for the back office (no React, no "@/" imports so node:test can
 * load this file directly). Owner: admin agent.
 *
 * Times: API sends RFC 3339 UTC; the shop operates in Asia/Bangkok (UTC+7, no DST).
 * Percent: integer basis points (1000 = 10%). Money: integer satang (see ../money.ts).
 */
import { formatBaht } from "../money.ts";

export const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

const dateFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" });
const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateFmt.format(new Date(iso));
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFmt.format(new Date(iso));
}
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return timeFmt.format(new Date(iso));
}

/** "2026-11-17T03:00:00Z" → "2026-11-17T10:00" (value for <input type="datetime-local"> in Bangkok time). */
export function toBkkInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + BKK_OFFSET_MS).toISOString().slice(0, 16);
}

/** "2026-11-17T10:00" (Bangkok) → "2026-11-17T03:00:00Z". Returns null when empty/invalid. */
export function fromBkkInput(value: string): string | null {
  if (!value) return null;
  const v = value.length === 10 ? `${value}T00:00` : value;
  const t = Date.parse(`${v.slice(0, 16)}:00Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t - BKK_OFFSET_MS).toISOString().replace(".000Z", "Z");
}

/** Bangkok calendar date "YYYY-MM-DD" of an instant. */
export function bkkDay(iso: string | number | Date): string {
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  return new Date(t + BKK_OFFSET_MS).toISOString().slice(0, 10);
}

/** "12.5" / "12.5%" → 1250 bp without floats. null when invalid or > 100% / more than 2 decimals. */
export function parsePercentToBp(input: string): number | null {
  const s = input.trim().replace(/%$/, "").trim();
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp > 10000 ? null : bp;
}

/** 1250 → "12.5" (for an input value). */
export function bpToInput(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return "";
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, "0")}`.replace(/0$/, "");
}

/** 123450 → "1234.50"; 21100 → "211" (for an input value; no grouping). */
export function satangToInput(satang: number | null | undefined): string {
  if (satang === null || satang === undefined) return "";
  const b = Math.floor(Math.abs(satang) / 100);
  const s = Math.abs(satang) % 100;
  return (satang < 0 ? "-" : "") + (s === 0 ? String(b) : `${b}.${String(s).padStart(2, "0")}`);
}

export function priceRange(min: number, max: number): string {
  return min === max ? formatBaht(min) : `${formatBaht(min)} – ${formatBaht(max)}`;
}

// ---------- window / campaign status ----------
export type WindowStatus = "upcoming" | "active" | "expired";
export function windowStatus(startsAt: string, endsAt: string | null, now: number = Date.now()): WindowStatus {
  if (Date.parse(startsAt) > now) return "upcoming";
  if (endsAt && Date.parse(endsAt) <= now) return "expired";
  return "active";
}
/** Whole days left until `endsAt` (ceil, min 0). */
export function daysLeft(endsAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 86_400_000));
}
/** Whole days until `startsAt` (ceil, min 0). */
export function daysUntil(startsAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(startsAt) - now) / 86_400_000));
}

// ---------- variants ----------
export type OptionDef = { name: string; values: string[] };
/** Cartesian product of option values: [{สี:"ขาว",ไซซ์:"M"}, ...] in option order. */
export function variantMatrix(options: OptionDef[]): Record<string, string>[] {
  const opts = options.filter((o) => o.name.trim() && o.values.length > 0);
  if (opts.length === 0) return [];
  let rows: Record<string, string>[] = [{}];
  for (const o of opts) {
    const next: Record<string, string>[] = [];
    for (const r of rows) for (const v of o.values) next.push({ ...r, [o.name]: v });
    rows = next;
  }
  return rows;
}
export function comboKey(values: Record<string, string>, options: OptionDef[]): string {
  return options.map((o) => `${o.name}=${values[o.name] ?? ""}`).join("|");
}
export function comboName(values: Record<string, string>, options: OptionDef[]): string {
  return options
    .map((o) => values[o.name])
    .filter(Boolean)
    .join(" / ");
}
/** 3-char base36 FNV-1a digest of the UTF-8 bytes (same as the API's CSV import `shortHash`). */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return (h % 46656).toString(36).toUpperCase().padStart(3, "0");
}
/**
 * Suggest a SKU: BASE[-SALT]-VAL1-VAL2 using ASCII-safe uppercase fragments. Values without ASCII (Thai colours)
 * become a short digest instead of a positional V1/V2, and `salt` (per product) keeps two products whose names
 * share the first 4 letters from colliding ("Linen Shirt" vs "Linen Shorts").
 */
export function suggestSku(base: string, values: string[], salt = ""): string {
  const frag = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 4);
  const parts = [frag(base) || "SKU", ...(salt ? [salt.toUpperCase().replace(/[^A-Z0-9]/g, "")] : []), ...values.map((v) => frag(v) || shortHash(v))];
  return parts.filter(Boolean).join("-").slice(0, 64);
}
/** `candidate`, or candidate-2, -3 … when it is already in `taken` (compared case-insensitively). */
export function uniqueSku(candidate: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((t) => t.trim().toUpperCase()));
  let out = candidate;
  for (let i = 2; set.has(out.toUpperCase()); i++) out = `${candidate}-${i}`;
  return out;
}

// ---------- codes ----------
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
/** Generate `count` unique codes PREFIX + random(length). `rand` injectable for tests. */
export function generateCodes(count: number, prefix: string, length: number, rand: () => number = Math.random): string[] {
  const out = new Set<string>();
  const p = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const max = Math.pow(CODE_ALPHABET.length, length);
  const target = Math.min(count, max);
  let guard = 0;
  while (out.size < target && guard < target * 50) {
    let s = "";
    for (let i = 0; i < length; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
    out.add(p + s);
    guard++;
  }
  return [...out];
}
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------- orders ----------
export type OrderStatusKey =
  | "pending_payment"
  | "paid"
  | "packing"
  | "shipped"
  | "delivered"
  | "completed"
  | "cancelled"
  | "refunded";

export const ORDER_STATUS_LABEL: Record<OrderStatusKey, string> = {
  pending_payment: "รอชำระ",
  paid: "ชำระแล้ว",
  packing: "กำลังแพ็ค",
  shipped: "ส่งแล้ว",
  delivered: "ถึงผู้รับ",
  completed: "สำเร็จ",
  cancelled: "ยกเลิก",
  refunded: "คืนเงิน",
};
export const ORDER_STATUS_ORDER: OrderStatusKey[] = [
  "pending_payment",
  "paid",
  "packing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "refunded",
];

/** Legal moves per API.md §12.3, with the permission each one needs. */
export const ORDER_TRANSITIONS: Record<OrderStatusKey, { to: OrderStatusKey; perm: "orders:fulfil" | "orders:manage" }[]> = {
  pending_payment: [{ to: "cancelled", perm: "orders:manage" }],
  paid: [
    { to: "packing", perm: "orders:fulfil" },
    { to: "cancelled", perm: "orders:manage" },
  ],
  packing: [
    { to: "shipped", perm: "orders:fulfil" },
    { to: "cancelled", perm: "orders:manage" },
  ],
  shipped: [{ to: "delivered", perm: "orders:fulfil" }],
  delivered: [
    { to: "completed", perm: "orders:fulfil" },
    { to: "refunded", perm: "orders:manage" },
  ],
  completed: [{ to: "refunded", perm: "orders:manage" }],
  cancelled: [],
  refunded: [],
};
export function canTransition(from: OrderStatusKey, to: OrderStatusKey): boolean {
  return ORDER_TRANSITIONS[from].some((t) => t.to === to);
}

export const TIER_LABEL = { standard: "ทั่วไป", silver: "Silver", gold: "Gold", platinum: "Platinum" } as const;
export const ROLE_LABEL = { customer: "ลูกค้า", staff: "พนักงาน", admin: "แอดมิน", owner: "เจ้าของร้าน" } as const;

export const PROMO_KIND_LABEL = {
  quantity_break: "ราคาตามจำนวน",
  group_price: "ส่วนลดกลุ่มลูกค้า",
  tier_price: "ส่วนลดระดับสมาชิก",
  buy_x_get_y: "ซื้อ N แถม M",
  cart_percent: "ลด %",
  cart_amount: "ลดเป็นบาท",
  free_shipping: "ส่งฟรี",
} as const;

/** Derive layer from kind + "needs a code" (API.md §12.2 matrix). */
export function deriveLayer(kind: keyof typeof PROMO_KIND_LABEL, withCode: boolean): 1 | 2 | 3 | 4 | 5 {
  if (kind === "quantity_break" || kind === "group_price" || kind === "tier_price") return 1;
  if (kind === "buy_x_get_y") return 2;
  if (withCode) return 4;
  return kind === "free_shipping" ? 5 : 3;
}

/** Thai relative-number helper: 1234 → "1,234". */
export function fmtInt(n: number): string {
  return new Intl.NumberFormat("th-TH").format(n);
}
