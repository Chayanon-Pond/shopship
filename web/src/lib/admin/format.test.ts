// Run: npm test (node:test with built-in TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bkkDay,
  bpToInput,
  canTransition,
  comboKey,
  daysLeft,
  deriveLayer,
  fromBkkInput,
  generateCodes,
  parsePercentToBp,
  satangToInput,
  shortHash,
  suggestSku,
  uniqueSku,
  toBkkInput,
  variantMatrix,
  windowStatus,
} from "./format.ts";
import { promoValue, usageText } from "./promo.ts";
import { adjustSchema, campaignSchema, fieldErrors, productSchema, promotionSchema, validate } from "./schemas.ts";

test("Bangkok datetime-local round trip (UTC+7, no floats)", () => {
  assert.equal(toBkkInput("2026-11-17T03:00:00Z"), "2026-11-17T10:00");
  assert.equal(fromBkkInput("2026-11-17T10:00"), "2026-11-17T03:00:00Z");
  assert.equal(fromBkkInput("2026-12-12T00:00"), "2026-12-11T17:00:00Z");
  assert.equal(fromBkkInput(""), null);
  assert.equal(toBkkInput(null), "");
  assert.equal(bkkDay("2026-11-17T17:30:00Z"), "2026-11-18");
});

test("percent <-> basis points", () => {
  assert.equal(parsePercentToBp("12.5"), 1250);
  assert.equal(parsePercentToBp("10%"), 1000);
  assert.equal(parsePercentToBp("0.05"), 5);
  assert.equal(parsePercentToBp("100"), 10000);
  assert.equal(parsePercentToBp("100.01"), null);
  assert.equal(parsePercentToBp("1.234"), null);
  assert.equal(parsePercentToBp("abc"), null);
  assert.equal(bpToInput(1250), "12.5");
  assert.equal(bpToInput(1205), "12.05");
  assert.equal(bpToInput(800), "8");
  assert.equal(bpToInput(null), "");
});

test("satang to input string", () => {
  assert.equal(satangToInput(123450), "1234.50");
  assert.equal(satangToInput(21100), "211");
  assert.equal(satangToInput(5), "0.05");
  assert.equal(satangToInput(null), "");
});

test("variant matrix size × colour", () => {
  const opts = [
    { name: "ไซซ์", values: ["S", "M"] },
    { name: "สี", values: ["ขาว", "ดำ", "เทา"] },
  ];
  const m = variantMatrix(opts);
  assert.equal(m.length, 6);
  assert.deepEqual(m[0], { ไซซ์: "S", สี: "ขาว" });
  assert.deepEqual(m[5], { ไซซ์: "M", สี: "เทา" });
  assert.equal(comboKey({ สี: "ดำ", ไซซ์: "M" }, opts), "ไซซ์=M|สี=ดำ");
  assert.deepEqual(variantMatrix([{ name: "สี", values: [] }]), []);
  assert.match(suggestSku("Linen Shirt", ["M", "ขาว"]), /^LINE-M-[0-9A-Z]{3}$/);
  assert.notEqual(suggestSku("Linen Shirt", ["M", "ขาว"]), suggestSku("Linen Shirt", ["M", "ดำ"]));
  // same 4-letter prefix, different products -> different SKUs once salted per product
  assert.notEqual(suggestSku("Linen Shirt", ["M"], "A1"), suggestSku("Linen Shorts", ["M"], "B2"));
  assert.equal(suggestSku("Linen Shirt", ["M"], "a1"), "LINE-A1-M");
  assert.equal(uniqueSku("LINE-M", ["line-m", "LINE-M-2"]), "LINE-M-3");
  assert.equal(shortHash("ขาว").length, 3);
});

test("code generator: unique, prefixed, unambiguous alphabet", () => {
  let s = 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const codes = generateCodes(200, "xmas", 6, rand);
  assert.equal(codes.length, 200);
  assert.equal(new Set(codes).size, 200);
  for (const c of codes) assert.match(c, /^XMAS[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(generateCodes(5000, "A", 1).length, 32); // capped by keyspace
});

test("window status / days left", () => {
  const now = Date.parse("2026-11-17T05:00:00Z");
  assert.equal(windowStatus("2026-11-10T17:00:00Z", "2026-11-17T17:00:00Z", now), "active");
  assert.equal(windowStatus("2026-12-11T17:00:00Z", "2026-12-12T17:00:00Z", now), "upcoming");
  assert.equal(windowStatus("2026-04-09T17:00:00Z", "2026-04-16T17:00:00Z", now), "expired");
  assert.equal(windowStatus("2026-11-01T00:00:00Z", null, now), "active");
  assert.equal(daysLeft("2026-11-17T17:00:00Z", now), 1);
});

test("order transitions follow API.md §12.3", () => {
  assert.ok(canTransition("paid", "packing"));
  assert.ok(canTransition("packing", "shipped"));
  assert.ok(canTransition("pending_payment", "cancelled"));
  assert.ok(canTransition("completed", "refunded"));
  assert.ok(!canTransition("pending_payment", "paid"));
  assert.ok(!canTransition("shipped", "cancelled"));
  assert.ok(!canTransition("cancelled", "paid"));
});

test("layer derivation matches the DB CHECK matrix", () => {
  assert.equal(deriveLayer("quantity_break", false), 1);
  assert.equal(deriveLayer("tier_price", true), 1);
  assert.equal(deriveLayer("buy_x_get_y", false), 2);
  assert.equal(deriveLayer("cart_percent", false), 3);
  assert.equal(deriveLayer("cart_amount", true), 4);
  assert.equal(deriveLayer("free_shipping", true), 4);
  assert.equal(deriveLayer("free_shipping", false), 5);
});

test("promo summaries", () => {
  const base = { percent_bp: null, amount_satang: null, buy_qty: null, get_qty: null, get_percent_bp: null, min_spend_satang: 0, max_discount_satang: null, qty_tiers: [] };
  assert.equal(promoValue({ ...base, kind: "cart_percent", percent_bp: 1200, max_discount_satang: 30000 }), "ลด 12% · สูงสุด ฿300");
  assert.equal(promoValue({ ...base, kind: "cart_amount", amount_satang: 15000, min_spend_satang: 100000 }), "ลด ฿150 · ขั้นต่ำ ฿1,000");
  assert.equal(promoValue({ ...base, kind: "buy_x_get_y", buy_qty: 2, get_qty: 1, get_percent_bp: 10000 }), "ซื้อ 2 แถม 1");
  assert.equal(promoValue({ ...base, kind: "quantity_break", qty_tiers: [{ min_qty: 10, unit_price_satang: 21000, percent_bp: null }, { min_qty: 50, unit_price_satang: null, percent_bp: 1500 }] }), "10+ ฿210 · 50+ −15%");
  assert.equal(usageText({ used_count: 412, usage_limit: 1000, per_customer_limit: 1 }), "412/1,000 · คนละ 1");
});

test("zod schemas: Thai messages, money via parseBahtToSatang", () => {
  const bad = validate(productSchema, { name: "", name_en: "", slug: "Bad Slug", category_id: "", seo_title: "", seo_description: "", variants: [{ sku: "A", price: "12.345", stock: "-1", weight: "100" }] });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.errors.name, "กรุณากรอกข้อมูลนี้");
    assert.match(bad.errors.slug, /a-z/);
    assert.equal(bad.errors.category_id, "กรุณาเลือกหมวดหมู่");
    assert.match(bad.errors["variants.0.price"], /จำนวนเงิน/);
    assert.equal(bad.errors["variants.0.stock"], "กรอกเป็นจำนวนเต็ม");
  }
  const ok = validate(productSchema, { name: "เสื้อ", name_en: "Shirt", slug: "shirt", category_id: "11", seo_title: "", seo_description: "", variants: [{ sku: "S-1", price: "1,290.50", stock: "3", weight: "200" }] });
  assert.equal(ok.ok, true);
  assert.equal(validate(adjustSchema, { delta: "0", reason: "x" }).ok, false);
  assert.equal(validate(adjustSchema, { delta: "-3", reason: "ชำรุด" }).ok, true);
  const camp = campaignSchema.safeParse({ name: "12.12", slug: "12-12", season_tag: "", starts_at: "2026-12-12T00:00", ends_at: "2026-12-11T00:00", accent: "#D70015", accent_contrast: "#FFFFFF", background: "#FFFFFF", badge_text: "", hero_image_url: "", priority: "1" });
  assert.equal(camp.success, false);
  if (!camp.success) assert.equal(fieldErrors(camp.error).ends_at, "วันสิ้นสุดต้องหลังวันเริ่ม");
  const promo = validate(promotionSchema, { name: "x", label: "y", kind: "cart_percent", withCode: true, percent: "150", amount: "", buy_qty: "", get_qty: "", get_percent: "", min_spend: "", max_discount: "", usage_limit: "", per_customer_limit: "", priority: "0", starts_at: "2026-11-17T10:00", ends_at: "", codes: "OK1 b@d" });
  assert.equal(promo.ok, false);
  if (!promo.ok) {
    assert.ok(promo.errors.percent);
    assert.match(promo.errors.codes, /b@d/);
  }
});
