/** Pure cart-display helpers (unit-tested). The client NEVER computes totals — only presentation. */
import type { CouponReason, CouponState, Hint, PriceSourceKind, Quote } from "../../lib/api/types.ts";

export type Tone = "success" | "info" | "warning" | "error";

/** Tone + optional follow-up action for every coupon reason_code (docs/API.md §6.3). */
export function couponFeedback(c: CouponState): { tone: Tone; title: string; action?: { label: string; href: string } } {
  if (c.status === "applied") return { tone: "success", title: "ใช้โค้ดสำเร็จ" };
  const r = c.reason_code as CouponReason;
  const map: Record<Exclude<CouponReason, "">, { tone: Tone; title: string; action?: { label: string; href: string } }> = {
    not_found: { tone: "error", title: "ไม่พบโค้ดนี้" },
    inactive: { tone: "error", title: "โค้ดนี้ปิดใช้งานแล้ว" },
    not_started: { tone: "warning", title: "โค้ดนี้ยังไม่เริ่มใช้งาน" },
    expired: { tone: "error", title: "โค้ดหมดอายุแล้ว" },
    usage_limit_reached: { tone: "error", title: "โค้ดถูกใช้ครบจำนวนแล้ว" },
    per_customer_limit_reached: { tone: "error", title: "คุณใช้โค้ดนี้ครบสิทธิ์แล้ว" },
    login_required: { tone: "warning", title: "ต้องเข้าสู่ระบบก่อนใช้โค้ด", action: { label: "เข้าสู่ระบบ", href: "/login?next=/cart" } },
    not_eligible_audience: { tone: "warning", title: "บัญชีของคุณไม่อยู่ในกลุ่มที่ใช้โค้ดนี้ได้" },
    min_spend_not_met: { tone: "info", title: "ยอดยังไม่ถึงขั้นต่ำของโค้ด", action: { label: "ช้อปเพิ่ม", href: "/search?sort=best_selling" } },
    no_eligible_items: { tone: "info", title: "ไม่มีสินค้าที่ร่วมรายการกับโค้ดนี้" },
    exclusive_not_better: { tone: "info", title: "เราเลือกส่วนลดที่คุ้มกว่าให้แล้ว" },
    shipping_already_free: { tone: "info", title: "ออเดอร์นี้ส่งฟรีอยู่แล้ว" },
  };
  return r && r in map ? map[r as Exclude<CouponReason, "">] : { tone: c.status === "invalid" ? "error" : "info", title: "ใช้โค้ดนี้ไม่ได้" };
}

/** Badge text for a line's price source; the API label wins (e.g. "ราคาสมาชิก Gold", "ราคาส่ง 10+ ชิ้น"). */
export function priceSourceBadge(kind: PriceSourceKind, label: string): string | null {
  if (kind === "list") return null;
  if (label) return label;
  return { flash_sale: "Flash Sale", quantity_break: "ราคาส่ง", group_price: "ราคากลุ่มลูกค้า", tier_price: "ราคาสมาชิก" }[kind] ?? null;
}

/** Free-shipping progress 0..100 from the quote hint (needs the API's remaining amount). */
export function freeShipProgress(q: Pick<Quote, "hints" | "totals">): { pct: number; hint: Hint } | null {
  const h = q.hints.find((x) => x.kind === "free_shipping_gap" && typeof x.amount_satang === "number");
  if (!h || !h.amount_satang) return null;
  const have = q.totals.subtotal_satang;
  const need = have + h.amount_satang;
  return { pct: need > 0 ? Math.max(4, Math.min(100, Math.floor((have * 100) / need))) : 0, hint: h };
}

export function blockingLines(q: Pick<Quote, "lines">) {
  return q.lines.filter((l) => l.availability.status !== "ok");
}
