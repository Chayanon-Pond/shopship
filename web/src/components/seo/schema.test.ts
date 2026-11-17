import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlashSale, Product, Review } from "../../lib/api/types.ts";
import { baht, breadcrumbs, itemList, liveFlash, organization, product, website, type Ctx } from "./schema.ts";
import { clampText, stripMarkdown } from "./text.ts";

const ctx: Ctx = { base: "https://shop.test", name: "ShopShip", freeShipMinSatang: 99000 };
const S = "https://schema.org/";

const variant = (id: number, price: number, level: "in_stock" | "low" | "out" = "in_stock") => ({
  id, sku: `SKU-${id}`, name: `V${id}`, option_values: {}, price_satang: price, in_stock: level !== "out", stock_level: level, image_id: null,
});
const base = (variants: ReturnType<typeof variant>[], extra: Partial<Product> = {}) =>
  ({
    id: 7, slug: "tee", name: "เสื้อยืด", subtitle: "นุ่ม", brand: "Siam", image: null, min_price_satang: 29000, max_price_satang: 29000,
    flash: null, rating_avg: 0, rating_count: 0, sold_count: 0, in_stock: true, badges: [], description: "**ผ้าดี** มาก\n- ข้อ 1",
    category: { id: 1, slug: "tshirts", name: "เสื้อยืด" }, breadcrumbs: [{ id: 1, slug: "tshirts", name: "เสื้อยืด" }], options: [],
    variants, images: [{ id: 1, url: "/media/a.jpg", alt: "", width: 800, height: 800 }],
    reviews_summary: { rating_avg: 0, rating_count: 0, histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, with_images_count: 0 },
    tags: [], seo: { title: "", description: "" }, ...extra,
  }) as Product;
const now = new Date("2026-11-17T10:00:00Z");
const flash = (variantId: number, remaining = 5): FlashSale => ({
  id: 1, label: "11.11", starts_at: "2026-11-17T07:00:00Z", ends_at: "2026-11-17T19:00:00Z",
  items: [{ flash_sale_item_id: 1, product: { id: 7 } as never, variant_id: variantId, variant_name: "", sale_price_satang: 19900,
    list_price_satang: 29000, lowest_30d_satang: 29000, qty_limit: 10, sold_qty: 10 - remaining, remaining_qty: remaining, per_customer_limit: null }],
});

test("baht formats satang with integer math", () => {
  assert.equal(baht(29000), "290.00");
  assert.equal(baht(15550), "155.50");
  assert.equal(baht(5), "0.05");
});

test("single variant → Offer with list price, absolute image, return policy, no shipping claim under the threshold", () => {
  const ld = product(ctx, base([variant(1, 29000)]), { reviews: [], flash: null, now });
  const o = ld.offers as Record<string, unknown>;
  assert.equal(o["@type"], "Offer");
  assert.equal(o.price, "290.00");
  assert.equal(o.priceCurrency, "THB");
  assert.equal(o.availability, `${S}InStock`);
  assert.equal(o.itemCondition, `${S}NewCondition`);
  assert.equal(o.shippingDetails, undefined);
  assert.equal((o.hasMerchantReturnPolicy as Record<string, unknown>).merchantReturnDays, 7);
  assert.deepEqual(ld.image, ["https://shop.test/media/a.jpg"]);
  assert.equal(ld.sku, "SKU-1");
  assert.equal(ld.description, "ผ้าดี มาก ข้อ 1");
  assert.equal(ld.aggregateRating, undefined);
  assert.equal(ld.review, undefined);
});

test("free shipping is only claimed at / above the threshold", () => {
  const ld = product(ctx, base([variant(1, 99000)]), { reviews: [], flash: null, now });
  const ship = (ld.offers as Record<string, Record<string, Record<string, unknown>>>).shippingDetails;
  assert.equal(ship.shippingRate.value, 0);
  assert.equal(ship.shippingDestination.addressCountry, "TH");
  const off = product({ ...ctx, freeShipMinSatang: null }, base([variant(1, 99000)]), { reviews: [], flash: null, now });
  assert.equal((off.offers as Record<string, unknown>).shippingDetails, undefined);
});

test("multi variant → AggregateOffer with low/high and best availability", () => {
  const ld = product(ctx, base([variant(1, 29000, "out"), variant(2, 35000, "low")]), { reviews: [], flash: null, now });
  const o = ld.offers as Record<string, unknown>;
  assert.equal(o["@type"], "AggregateOffer");
  assert.equal(o.lowPrice, "290.00");
  assert.equal(o.highPrice, "350.00");
  assert.equal(o.offerCount, 2);
  assert.equal(o.availability, `${S}LimitedAvailability`);
  const inner = o.offers as Record<string, unknown>[];
  assert.equal(inner[0].availability, `${S}OutOfStock`);
  assert.equal(ld.sku, undefined);
});

test("flash price only for the live flash variant, with priceValidUntil", () => {
  const p = base([variant(1, 29000), variant(2, 29000)]);
  const ld = product(ctx, p, { reviews: [], flash: flash(2), now });
  const inner = (ld.offers as Record<string, unknown>).offers as Record<string, unknown>[];
  assert.equal(inner[0].price, "290.00");
  assert.equal(inner[1].price, "199.00");
  assert.equal(inner[1].priceValidUntil, "2026-11-17");
  assert.equal(inner[1].availability, `${S}LimitedAvailability`);
  assert.equal((ld.offers as Record<string, unknown>).lowPrice, "199.00");
  // ended, not started, sold out → list price
  assert.equal(liveFlash(p, flash(2), new Date("2026-11-17T19:00:00Z")), null);
  assert.equal(liveFlash(p, flash(2), new Date("2026-11-17T06:59:59Z")), null);
  assert.equal(liveFlash(p, flash(2, 0), now), null);
});

test("ratings and reviews only from real data", () => {
  const reviews: Review[] = [
    { id: 1, rating: 5, title: "ดี", body: "ชอบ", author_name: "สมชาย", variant_name: "", images: [], created_at: "2026-11-01T03:00:00Z", reply: null },
    { id: 2, rating: 4, title: "", body: "", author_name: " ", variant_name: "", images: [], created_at: "2026-11-02T03:00:00Z", reply: null },
  ];
  const p = base([variant(1, 29000)], { reviews_summary: { rating_avg: 4.4286, rating_count: 7, histogram: { 1: 0, 2: 0, 3: 1, 4: 2, 5: 4 }, with_images_count: 0 } });
  const ld = product(ctx, p, { reviews, flash: null, now });
  assert.deepEqual(ld.aggregateRating, { "@type": "AggregateRating", ratingValue: 4.4, reviewCount: 7, bestRating: 5, worstRating: 1 });
  const r = ld.review as Record<string, unknown>[];
  assert.equal(r.length, 1); // the anonymous one is dropped
  assert.equal(r[0].datePublished, "2026-11-01");
});

test("organization, website, breadcrumbs, item list", () => {
  const org = organization(ctx);
  assert.equal(org["@type"], "Organization");
  assert.ok(org.hasMerchantReturnPolicy);
  const ws = website(ctx);
  assert.equal((ws.potentialAction as { target: { urlTemplate: string } }).target.urlTemplate, "https://shop.test/search?q={search_term_string}");
  const bc = breadcrumbs(ctx, [{ name: "หน้าแรก", url: "/" }, { name: "เสื้อ", url: "/c/tshirts" }]);
  assert.deepEqual((bc.itemListElement as { item: string }[]).map((x) => x.item), ["https://shop.test/", "https://shop.test/c/tshirts"]);
  const il = itemList(ctx, "x", [{ slug: "a", name: "A" }]);
  assert.equal((il.itemListElement as { url: string }[])[0].url, "https://shop.test/p/a");
});

test("clampText never cuts a Thai word or leaves a dangling mark", () => {
  const t = "เสื้อยืดคอตตอนคลาสสิกสีขาวใส่สบายทุกวันราคาดีส่งไวทั่วประเทศไทย";
  const c = clampText(t, 20);
  assert.ok(c.length <= 20, c);
  assert.ok(c.endsWith("…"));
  assert.ok(t.startsWith(c.slice(0, -1)));
  // the char after the cut must not be a combining vowel / tone mark (U+0E31, U+0E34–0E3A, U+0E47–0E4E)
  const next = t.charAt(c.length - 1);
  assert.ok(!/[ัิ-ฺ็-๎]/.test(next), `split before "${next}"`);
  assert.equal(clampText("สั้น", 20), "สั้น");
  assert.equal(stripMarkdown("# หัว\n[ลิงก์](https://x) **ตัวหนา**"), "หัว ลิงก์ ตัวหนา");
});
