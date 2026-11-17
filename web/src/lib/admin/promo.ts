/** Display helpers for promotions (pure). */
import type { AdminPromotion } from "../api/types.ts";
import { formatBaht, formatBp } from "../money.ts";

export const LAYER_LABEL: Record<number, string> = {
  1: "ชั้น 1 · ราคาต่อชิ้น",
  2: "ชั้น 2 · โปรรายการ",
  3: "ชั้น 3 · ส่วนลดตะกร้าอัตโนมัติ",
  4: "ชั้น 4 · โค้ดส่วนลด",
  5: "ชั้น 5 · ค่าส่ง",
};

/** One-line Thai summary of what a promotion gives, e.g. "ลด 10% สูงสุด ฿300 · ขั้นต่ำ ฿1,000". */
export function promoValue(p: Pick<AdminPromotion, "kind" | "percent_bp" | "amount_satang" | "buy_qty" | "get_qty" | "get_percent_bp" | "min_spend_satang" | "max_discount_satang" | "qty_tiers">): string {
  const parts: string[] = [];
  switch (p.kind) {
    case "cart_percent":
    case "group_price":
    case "tier_price":
      parts.push(`ลด ${formatBp(p.percent_bp ?? 0)}`);
      if (p.max_discount_satang !== null && p.kind === "cart_percent") parts.push(`สูงสุด ${formatBaht(p.max_discount_satang)}`);
      break;
    case "cart_amount":
      parts.push(`ลด ${formatBaht(p.amount_satang ?? 0)}`);
      break;
    case "free_shipping":
      parts.push(p.max_discount_satang !== null ? `ส่งฟรี (ไม่เกิน ${formatBaht(p.max_discount_satang)})` : "ส่งฟรี");
      break;
    case "buy_x_get_y":
      parts.push(
        `ซื้อ ${p.buy_qty ?? 0} ${!p.get_percent_bp || p.get_percent_bp === 10000 ? `แถม ${p.get_qty ?? 0}` : `ชิ้นที่ ${(p.buy_qty ?? 0) + 1} ลด ${formatBp(p.get_percent_bp)}`}`,
      );
      break;
    case "quantity_break":
      parts.push(
        p.qty_tiers
          .map((t) => `${t.min_qty}+ ${t.unit_price_satang !== null ? formatBaht(t.unit_price_satang) : `−${formatBp(t.percent_bp ?? 0)}`}`)
          .join(" · ") || "ยังไม่มีขั้นราคา",
      );
      break;
  }
  if (p.min_spend_satang > 0) parts.push(`ขั้นต่ำ ${formatBaht(p.min_spend_satang)}`);
  return parts.join(" · ");
}

export function usageText(p: Pick<AdminPromotion, "used_count" | "usage_limit" | "per_customer_limit">): string {
  const a = p.usage_limit !== null ? `${p.used_count.toLocaleString("th-TH")}/${p.usage_limit.toLocaleString("th-TH")}` : `${p.used_count.toLocaleString("th-TH")} ครั้ง`;
  return p.per_customer_limit !== null ? `${a} · คนละ ${p.per_customer_limit}` : a;
}
