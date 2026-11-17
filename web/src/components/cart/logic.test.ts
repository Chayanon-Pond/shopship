import assert from "node:assert/strict";
import { test } from "node:test";
import type { CouponReason, Quote } from "../../lib/api/types.ts";
import { blockingLines, couponFeedback, freeShipProgress, priceSourceBadge } from "./logic.ts";

const reasons: CouponReason[] = [
  "not_found", "inactive", "not_started", "expired", "usage_limit_reached", "per_customer_limit_reached", "login_required",
  "not_eligible_audience", "min_spend_not_met", "no_eligible_items", "exclusive_not_better", "shipping_already_free",
];

test("every coupon reason_code has a Thai title", () => {
  for (const r of reasons) {
    const f = couponFeedback({ code: "X", status: "invalid", reason_code: r, message: "" });
    assert.ok(f.title.length > 0, r);
    assert.notEqual(f.title, "ใช้โค้ดนี้ไม่ได้", r);
  }
  assert.equal(couponFeedback({ code: "X", status: "applied", reason_code: "", message: "" }).tone, "success");
  assert.equal(couponFeedback({ code: "X", status: "invalid", reason_code: "login_required", message: "" }).action?.href, "/login?next=/cart");
});

test("price source badge prefers the API label", () => {
  assert.equal(priceSourceBadge("list", ""), null);
  assert.equal(priceSourceBadge("tier_price", "สมาชิก Gold ลด 10%"), "สมาชิก Gold ลด 10%");
  assert.equal(priceSourceBadge("flash_sale", ""), "Flash Sale");
});

test("free shipping progress from the fixture hint (฿788 of ฿999)", () => {
  const q = {
    totals: { list_subtotal_satang: 118700, subtotal_satang: 78800, discount_satang: 0, shipping_satang: 4000, savings_satang: 39900, grand_total_satang: 82800 },
    hints: [{ kind: "free_shipping_gap", message: "ช้อปเพิ่มอีก ฿211 รับส่งฟรี", amount_satang: 21100 }],
  } as Pick<Quote, "hints" | "totals">;
  assert.equal(freeShipProgress(q)?.pct, 78);
  assert.equal(freeShipProgress({ ...q, hints: [] }), null);
});

test("blocking lines", () => {
  const line = (status: "ok" | "out_of_stock") => ({ availability: { status, available_qty: 0 } }) as Quote["lines"][number];
  assert.equal(blockingLines({ lines: [line("ok"), line("out_of_stock")] }).length, 1);
});
