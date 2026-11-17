/**
 * Stateful storefront mock (NEXT_PUBLIC_USE_MOCKS=true only). Added by the
 * Wave-1 storefront agent; lives beside handler.ts and never changes it.
 *
 * It answers the storefront routes the fixture handler cannot answer well
 * (filters, product-by-slug, cart mutations, coupons, session, addresses,
 * wishlist, orders, charges) with the SAME contract shapes (docs/API.md), and
 * returns `undefined` for anything else so `handler.ts` serves the fixture.
 *
 * The tiny pricing engine below only exists so the demo cart is coherent; it
 * reproduces the golden fixtures (cart.json / cart-quote-*.json totals) for the
 * same inputs. The real engine is api/internal/pricing.
 */
import { ApiError, type Query } from "@/lib/api/client";
import type {
  Address,
  Adjustment,
  Campaign,
  Cart,
  CartItem,
  Category,
  Charge,
  CouponReason,
  CouponState,
  FlashSale,
  FlashSaleItem,
  Hint,
  Image,
  Me,
  Offer,
  Order,
  OrderSummary,
  PriceSource,
  Product,
  ProductCard,
  Quote,
  QuoteLine,
  Review,
  Variant,
} from "@/lib/api/types";
import campaignFx from "./fixtures/campaign-active.json";
import bannersFx from "./fixtures/banners.json";
import categoriesFx from "./fixtures/categories.json";
import meFx from "./fixtures/me.json";
import orderFx from "./fixtures/order-detail.json";
import productDetailFx from "./fixtures/product-detail.json";
import reviewsFx from "./fixtures/product-reviews.json";

// ------------------------------------------------------------------ catalog
type VDef = [id: number, sku: string, opts: Record<string, string>, price: number, stock: number];
type PDef = {
  id: number;
  slug: string;
  name: string;
  name_en: string;
  subtitle: string;
  brand: string;
  cat: string;
  img: string[];
  options: { name: string; values: string[] }[];
  variants: VDef[];
  rating: number;
  ratingCount: number;
  sold: number;
  tags: string[];
  desc: string;
  age: number; // days since created (newest sort)
};

const A = (f: string) => `/demo/${f}.svg`;

const DEFS: PDef[] = [
  {
    id: 14, slug: "smart-watch-lite", name: "สมาร์ทวอทช์ Lite", name_en: "Smart Watch Lite", subtitle: "จอ AMOLED แบต 7 วัน",
    brand: "ShopShip", cat: "wearables", img: [A("smart-watch-lite"), A("smart-watch-silver")],
    options: [{ name: "สี", values: ["ดำ", "เงิน"] }],
    variants: [[401, "SW-LITE-BLK", { สี: "ดำ" }, 89000, 38], [402, "SW-LITE-SLV", { สี: "เงิน" }, 89000, 0]],
    rating: 4.6, ratingCount: 212, sold: 1840, tags: ["watch", "wearable"], age: 40,
    desc: "สมาร์ทวอทช์จอ AMOLED สว่างชัดกลางแดด วัดหัวใจ การนอน และออกซิเจนในเลือด\n\n- แบตเตอรี่ใช้ได้ 7 วัน\n- กันน้ำ 5 ATM\n- รองรับ iOS และ Android",
  },
  {
    id: 12, slug: "linen-shirt", name: "เสื้อเชิ้ตลินิน", name_en: "Linen Shirt", subtitle: "ผ้าลินินแท้ ใส่สบาย",
    brand: "ShopShip Basics", cat: "shirts", img: [A("linen-shirt-white"), A("linen-shirt-navy")],
    options: [], variants: [], rating: 4.8, ratingCount: 96, sold: 640, tags: ["linen", "shirt"], age: 12, desc: "",
  },
  {
    id: 13, slug: "wireless-earbuds-pro", name: "หูฟังไร้สาย Pro", name_en: "Wireless Earbuds Pro", subtitle: "ตัดเสียงรบกวน ANC",
    brand: "ShopShip Audio", cat: "audio", img: [A("earbuds-pro")],
    options: [{ name: "สี", values: ["ขาว", "ดำ"] }],
    variants: [[301, "EAR-PRO-WHT", { สี: "ขาว" }, 120000, 50], [302, "EAR-PRO-BLK", { สี: "ดำ" }, 120000, 6]],
    rating: 4.7, ratingCount: 388, sold: 2210, tags: ["earbuds", "anc"], age: 60,
    desc: "หูฟังไร้สายตัดเสียงรบกวนแบบแอคทีฟ เสียงเบสแน่น ฟังสบายทั้งวัน\n\n- ANC ลดเสียงรบกวนสูงสุด 35 dB\n- ฟังต่อเนื่อง 8 ชม. (รวมเคส 30 ชม.)\n- ชาร์จไร้สาย",
  },
  {
    id: 11, slug: "canvas-tote-bag", name: "ถุงผ้าแคนวาส", name_en: "Canvas Tote Bag", subtitle: "แคนวาสหนา 12 ออนซ์",
    brand: "ShopShip Basics", cat: "bags", img: [A("canvas-tote")],
    options: [{ name: "สี", values: ["สีธรรมชาติ"] }],
    variants: [[101, "TOTE-NAT", { สี: "สีธรรมชาติ" }, 25000, 500]],
    rating: 4.5, ratingCount: 154, sold: 3120, tags: ["tote", "bag"], age: 90,
    desc: "ถุงผ้าแคนวาสหนา 12 ออนซ์ เย็บสองชั้น รับน้ำหนักได้ 15 กก. เหมาะทำของชำร่วยและสกรีนโลโก้\n\n- ขนาด 38 × 42 ซม.\n- หูยาว 60 ซม.\n- สั่ง 10 ใบขึ้นไปได้ราคาส่ง",
  },
  {
    id: 15, slug: "cotton-socks", name: "ถุงเท้าคอตตอน", name_en: "Cotton Socks", subtitle: "คอตตอน 80% ระบายอากาศ",
    brand: "ShopShip Basics", cat: "socks", img: [A("cotton-socks")],
    options: [{ name: "สี", values: ["ดำ", "ขาว"] }, { name: "ไซซ์", values: ["ฟรีไซซ์"] }],
    variants: [[501, "SOCK-BLK-F", { สี: "ดำ", ไซซ์: "ฟรีไซซ์" }, 9900, 200], [502, "SOCK-WHT-F", { สี: "ขาว", ไซซ์: "ฟรีไซซ์" }, 9900, 120]],
    rating: 4.4, ratingCount: 120, sold: 980, tags: ["socks"], age: 30,
    desc: "ถุงเท้าคอตตอน 80% นุ่ม ระบายอากาศดี ไม่อับชื้น\n\n- ฟรีไซซ์ (เท้า 38–44)\n- ซื้อ 2 แถม 1",
  },
  {
    id: 16, slug: "ceramic-mug", name: "แก้วเซรามิก", name_en: "Ceramic Mug", subtitle: "350 ml เข้าไมโครเวฟได้",
    brand: "ShopShip Home", cat: "kitchen", img: [A("ceramic-mug")],
    options: [{ name: "สี", values: ["ขาว"] }],
    variants: [[601, "MUG-WHT", { สี: "ขาว" }, 29000, 0]],
    rating: 0, ratingCount: 0, sold: 0, tags: ["mug"], age: 2,
    desc: "แก้วเซรามิกเนื้อหนา เคลือบด้าน จับถนัดมือ ใช้กับไมโครเวฟและเครื่องล้างจานได้",
  },
  {
    id: 17, slug: "daypack-20l", name: "กระเป๋าเป้ Daypack 20L", name_en: "Daypack 20L", subtitle: "กันน้ำ ใส่โน้ตบุ๊ก 15 นิ้ว",
    brand: "ShopShip Travel", cat: "bags", img: [A("daypack")],
    options: [{ name: "สี", values: ["ดำ", "เทา"] }],
    variants: [[701, "PACK-BLK", { สี: "ดำ" }, 129000, 40], [702, "PACK-GRY", { สี: "เทา" }, 129000, 4]],
    rating: 4.9, ratingCount: 61, sold: 430, tags: ["backpack", "bag", "travel"], age: 5,
    desc: "เป้ใบเดียวจบทั้งทำงานและเที่ยว ผ้ากันน้ำ ช่องโน้ตบุ๊กบุโฟม 15 นิ้ว\n\n- ความจุ 20 ลิตร\n- ช่องซิปลับด้านหลัง\n- น้ำหนัก 650 กรัม",
  },
  {
    id: 18, slug: "cotton-tee", name: "เสื้อยืดคอตตอน", name_en: "Cotton Tee", subtitle: "คอตตอน 100% ซื้อยิ่งเยอะยิ่งถูก",
    brand: "ShopShip Basics", cat: "shirts", img: [A("cotton-tee"), A("cotton-tee-black")],
    options: [{ name: "สี", values: ["ขาว", "ดำ"] }, { name: "ไซซ์", values: ["S", "M", "L"] }],
    variants: [
      [801, "TEE-WHT-S", { สี: "ขาว", ไซซ์: "S" }, 29000, 80], [802, "TEE-WHT-M", { สี: "ขาว", ไซซ์: "M" }, 29000, 120],
      [803, "TEE-WHT-L", { สี: "ขาว", ไซซ์: "L" }, 29000, 3], [804, "TEE-BLK-S", { สี: "ดำ", ไซซ์: "S" }, 29000, 0],
      [805, "TEE-BLK-M", { สี: "ดำ", ไซซ์: "M" }, 29000, 90], [806, "TEE-BLK-L", { สี: "ดำ", ไซซ์: "L" }, 29000, 60],
    ],
    rating: 4.6, ratingCount: 530, sold: 5400, tags: ["tee", "shirt", "เสื้อยืด"], age: 20,
    desc: "เสื้อยืดคอตตอน 100% เนื้อผ้า 180 แกรม ทรงตรง ไม่ย้วย สกรีนได้\n\n- ซื้อ 5 ตัวลด 5% · 10 ตัวลด 10% (ราคาส่ง)\n- ซักเครื่องได้",
  },
  {
    id: 19, slug: "bluetooth-speaker-mini", name: "ลำโพงบลูทูธ Mini", name_en: "Bluetooth Speaker Mini", subtitle: "เสียง 360° กันน้ำ IPX7",
    brand: "ShopShip Audio", cat: "audio", img: [A("speaker-mini")],
    options: [{ name: "สี", values: ["น้ำเงิน", "ขาว"] }],
    variants: [[901, "SPK-MINI-BLU", { สี: "น้ำเงิน" }, 159000, 14], [902, "SPK-MINI-WHT", { สี: "ขาว" }, 159000, 30]],
    rating: 4.5, ratingCount: 97, sold: 760, tags: ["speaker", "bluetooth"], age: 8,
    desc: "ลำโพงพกพาเสียง 360 องศา เบสหนัก กันน้ำ IPX7 ฟังต่อเนื่อง 12 ชั่วโมง",
  },
  {
    id: 20, slug: "insulated-bottle", name: "ขวดน้ำเก็บความเย็น 750 ml", name_en: "Insulated Bottle 750 ml", subtitle: "เย็นนาน 24 ชม.",
    brand: "ShopShip Home", cat: "kitchen", img: [A("bottle")],
    options: [{ name: "สี", values: ["ขาว", "ฟ้า"] }],
    variants: [[1001, "BTL-WHT", { สี: "ขาว" }, 45000, 70], [1002, "BTL-BLU", { สี: "ฟ้า" }, 45000, 25]],
    rating: 4.7, ratingCount: 210, sold: 1990, tags: ["bottle", "tumbler"], age: 15,
    desc: "ขวดสแตนเลสสองชั้น เก็บความเย็น 24 ชม. ความร้อน 12 ชม. ฝาเกลียวกันรั่ว",
  },
  {
    id: 21, slug: "sport-band", name: "สายนาฬิกาซิลิโคน", name_en: "Sport Band", subtitle: "นุ่ม ใส่ออกกำลังกายได้",
    brand: "ShopShip", cat: "wearables", img: [A("sport-band")],
    options: [{ name: "สี", values: ["ส้ม", "ขาว", "ดำ"] }],
    variants: [[1101, "BAND-ORG", { สี: "ส้ม" }, 19000, 50], [1102, "BAND-WHT", { สี: "ขาว" }, 19000, 50], [1103, "BAND-BLK", { สี: "ดำ" }, 19000, 50]],
    rating: 4.3, ratingCount: 44, sold: 380, tags: ["band", "watch"], age: 3,
    desc: "สายซิลิโคนเกรดการแพทย์ สำหรับสมาร์ทวอทช์ Lite เปลี่ยนง่ายด้วยสลักกดเร็ว",
  },
  {
    id: 22, slug: "ceramic-plate-set", name: "ชุดจานเซรามิก 4 ใบ", name_en: "Ceramic Plate Set", subtitle: "เนื้อสโตนแวร์ ขนาด 10 นิ้ว",
    brand: "ShopShip Home", cat: "kitchen", img: [A("plate-set")],
    options: [], variants: [[1201, "PLATE-4", {}, 79000, 22]],
    rating: 4.8, ratingCount: 33, sold: 150, tags: ["plate", "kitchen"], age: 1,
    desc: "จานสโตนแวร์เคลือบด้าน 4 ใบ ทนความร้อน ใช้กับเครื่องล้างจานได้",
  },
  {
    id: 23, slug: "pique-polo", name: "เสื้อโปโลพิเก้", name_en: "Piqué Polo", subtitle: "ผ้าพิเก้ ระบายอากาศ ใส่ทำงานได้",
    brand: "ShopShip Basics", cat: "shirts", img: [A("polo")],
    options: [{ name: "ไซซ์", values: ["M", "L", "XL"] }],
    variants: [[1301, "POLO-M", { ไซซ์: "M" }, 49000, 30], [1302, "POLO-L", { ไซซ์: "L" }, 49000, 30], [1303, "POLO-XL", { ไซซ์: "XL" }, 49000, 0]],
    rating: 4.6, ratingCount: 72, sold: 520, tags: ["polo", "shirt"], age: 25,
    desc: "เสื้อโปโลผ้าพิเก้ทอแน่น ใส่สบาย ปักโลโก้บริษัทได้ สั่งจำนวนมากรับราคาส่ง",
  },
  {
    id: 24, slug: "ankle-socks-5-pack", name: "ถุงเท้าข้อสั้น แพ็ก 5 คู่", name_en: "Ankle Socks 5-Pack", subtitle: "คุ้มกว่า เฉลี่ยคู่ละ ฿52",
    brand: "ShopShip Basics", cat: "socks", img: [A("ankle-socks")],
    options: [], variants: [[1401, "SOCK5-MIX", {}, 25900, 90]],
    rating: 4.5, ratingCount: 88, sold: 1210, tags: ["socks"], age: 10,
    desc: "ถุงเท้าข้อสั้นคละสี 5 คู่ ผ้าหนานุ่ม ขอบไม่รัด",
  },
];

// linen shirt comes from the golden product-detail fixture
const linen = productDetailFx.data as unknown as Product;
const LINEN_STOCK: Record<number, number> = { 205: 50, 206: 4, 207: 0, 208: 40 };

const catIndex = new Map<string, { cat: Category; parent: Category | null }>();
for (const c of categoriesFx.data as unknown as Category[]) {
  catIndex.set(c.slug, { cat: c, parent: null });
  for (const ch of c.children) catIndex.set(ch.slug, { cat: ch, parent: c });
}

function img(id: number, url: string, alt: string): Image {
  return { id, url, alt, width: 800, height: 800 };
}
const stockLevel = (n: number): Variant["stock_level"] => (n <= 0 ? "out" : n <= 10 ? "low" : "in_stock");

type Entry = { product: Product; stock: Map<number, number>; age: number };
const PRODUCTS: Entry[] = DEFS.map((d) => {
  const ref = catIndex.get(d.cat)!;
  const crumbs = [ref.parent, ref.cat].filter(Boolean).map((c) => ({ id: c!.id, slug: c!.slug, name: c!.name }));
  if (d.slug === "linen-shirt") {
    const images = [img(121, A("linen-shirt-white"), "เสื้อเชิ้ตลินิน สีขาว"), img(122, A("linen-shirt-navy"), "เสื้อเชิ้ตลินิน สีกรมท่า")];
    const p: Product = { ...linen, name_en: d.name_en, image: images[0], images, badges: [] };
    return { product: p, stock: new Map(Object.entries(LINEN_STOCK).map(([k, v]) => [Number(k), v])), age: d.age };
  }
  const images = d.img.map((u, i) => img(d.id * 10 + i + 1, u, `${d.name}${i ? ` ภาพที่ ${i + 1}` : ""}`));
  const variants: Variant[] = d.variants.map(([id, sku, opts, price, stock], i) => ({
    id,
    sku,
    name: Object.values(opts).join(" / ") || "มาตรฐาน",
    option_values: opts,
    price_satang: price,
    in_stock: stock > 0,
    stock_level: stockLevel(stock),
    image_id: images[Math.min(i, images.length - 1)]?.id ?? null,
  }));
  // colour-specific image: first option value index
  if (d.options[0] && images.length > 1) {
    for (const v of variants) {
      const idx = d.options[0].values.indexOf(v.option_values[d.options[0].name]);
      v.image_id = images[Math.max(0, Math.min(idx, images.length - 1))].id;
    }
  }
  const prices = variants.map((v) => v.price_satang);
  const total = d.ratingCount;
  const h5 = Math.round(total * (d.rating >= 4.7 ? 0.82 : 0.66));
  const h4 = Math.round(total * 0.2);
  const rest = Math.max(0, total - h5 - h4);
  const product: Product = {
    id: d.id,
    slug: d.slug,
    name: d.name,
    name_en: d.name_en,
    subtitle: d.subtitle,
    brand: d.brand,
    image: images[0] ?? null,
    min_price_satang: Math.min(...prices),
    max_price_satang: Math.max(...prices),
    flash: null,
    rating_avg: d.rating,
    rating_count: d.ratingCount,
    sold_count: d.sold,
    in_stock: variants.some((v) => v.in_stock),
    badges: [],
    description: d.desc,
    category: crumbs[crumbs.length - 1],
    breadcrumbs: crumbs,
    options: d.options,
    variants,
    images,
    reviews_summary: {
      rating_avg: d.rating,
      rating_count: total,
      histogram: { "1": Math.floor(rest / 3), "2": Math.floor(rest / 3), "3": rest - 2 * Math.floor(rest / 3), "4": h4, "5": h5 },
      with_images_count: Math.round(total * 0.1),
    },
    tags: d.tags,
    seo: { title: `${d.name} | ShopShip`, description: `${d.name} ${d.subtitle} ส่งไวทั่วไทย` },
  };
  return { product, stock: new Map(d.variants.map(([id, , , , s]) => [id, s])), age: d.age };
});

const bySlug = new Map(PRODUCTS.map((e) => [e.product.slug, e]));
const byVariant = new Map<number, { e: Entry; v: Variant }>();
for (const e of PRODUCTS) for (const v of e.product.variants) byVariant.set(v.id, { e, v });

// ------------------------------------------------------------------ promotions (mock ruleset)
const FREE_SHIP_MIN = 99900;
const SHIP_FEE = 4000;
type Break = { min: number; unit?: number; bp?: number };
const QTY_BREAKS: { id: number; label: (min: number) => string; variants: number[]; breaks: Break[] }[] = [
  { id: 11, label: (m) => `ราคาส่ง ${m} ชิ้นขึ้นไป`, variants: [101], breaks: [{ min: 10, unit: 21000 }, { min: 50, unit: 19000 }] },
  {
    id: 12,
    label: (m) => `ราคาส่ง ${m} ชิ้นขึ้นไป`,
    variants: [801, 802, 803, 804, 805, 806, 1001, 1002, 1101, 1102, 1103, 1301, 1302, 1303, 1401],
    breaks: [{ min: 5, bp: 500 }, { min: 10, bp: 1000 }],
  },
];
const TIER_PROMO = { id: 13, label: "สมาชิก Gold ลด 10%", tier: "gold", bp: 1000, cats: ["shirts"] };
const BXGY = { id: 15, label: "ซื้อ 2 แถม 1", buy: 2, get: 1, variants: [501, 502] };
const CART_AUTO = { id: 21, label: "ช้อปครบ ฿1,000 ลด ฿150", min: 100000, amount: 15000, cats: ["audio", "wearables"] };

type Code = {
  code: string;
  id: number;
  kind: "percent" | "amount" | "free_shipping";
  value: number;
  label: string;
  exclusive?: boolean;
  min?: number;
  max?: number;
  group?: string;
  login?: boolean;
  state?: CouponReason;
  endText?: string;
};
const CODES: Code[] = [
  { code: "TRADE5", id: 41, kind: "percent", value: 500, label: "โค้ด TRADE5 ลด 5%", group: "trade", login: true },
  { code: "SAVE10X", id: 42, kind: "percent", value: 1000, label: "โค้ด SAVE10X ลด 10%", exclusive: true },
  { code: "SONGKRAN26", id: 43, kind: "percent", value: 1000, label: "โค้ด SONGKRAN26", state: "expired", endText: "16 เม.ย. 2026" },
  { code: "1111SALE", id: 44, kind: "percent", value: 1100, label: "โค้ด 1111SALE ลด 11%", min: 50000, max: 20000 },
  { code: "FREESHIP", id: 45, kind: "free_shipping", value: 0, label: "โค้ด FREESHIP ส่งฟรี" },
  { code: "FREESHIP11", id: 50, kind: "free_shipping", value: 0, label: "โค้ด FREESHIP11 ส่งฟรี" },
  { code: "NEWYEAR27", id: 46, kind: "percent", value: 1000, label: "โค้ด NEWYEAR27", state: "not_started" },
  { code: "LIMITED50", id: 47, kind: "amount", value: 5000, label: "โค้ด LIMITED50", state: "usage_limit_reached" },
  { code: "WELCOME100", id: 48, kind: "amount", value: 10000, label: "โค้ด WELCOME100 ลด ฿100", min: 50000, login: true },
  { code: "BAGS15", id: 49, kind: "percent", value: 1500, label: "โค้ด BAGS15 ลด 15%" },
];

const thb = (s: number) => {
  const b = Math.floor(Math.abs(s) / 100);
  const st = Math.abs(s) % 100;
  return "฿" + b.toLocaleString("en-US") + (st ? "." + String(st).padStart(2, "0") : "");
};
const halfUp = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));

// ------------------------------------------------------------------ state (browser: localStorage)
type State = {
  user: Me | null;
  cart: { variant_id: number; qty: number }[];
  coupon: string | null;
  addresses: Address[];
  wishlist: number[];
  orders: Order[];
  charges: Record<string, Charge>;
  priceChangedOnce?: boolean;
};
const KEY = "shopship_mock_v1";
let mem: State | null = null;
function fresh(): State {
  const a = orderFx.data.shipping_address;
  return {
    user: null,
    cart: [
      { variant_id: 401, qty: 1 },
      { variant_id: 502, qty: 3 },
    ],
    coupon: null,
    addresses: [
      { ...(a as Omit<Address, "id">), id: 1 },
      {
        id: 2, label: "บ้าน", recipient_name: "สมชาย ใจดี", phone: "0898765432", line1: "12/3 หมู่บ้านสวนสน", line2: "ถนนรัตนาธิเบศร์",
        subdistrict: "บางกระสอ", district: "เมืองนนทบุรี", province: "นนทบุรี", postal_code: "11000", country: "TH", is_default: false,
      },
    ],
    wishlist: [17],
    orders: [orderFx.data as unknown as Order],
    charges: {},
  };
}
function load(): State {
  if (mem) return mem;
  mem = fresh();
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) mem = { ...mem, ...(JSON.parse(raw) as State) };
    } catch {
      /* private mode */
    }
  }
  return mem;
}
function save() {
  if (typeof window === "undefined" || !mem) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ time-shifted flash sale + campaign
function nowMs() {
  return Date.now();
}
/** Flash sale window: started 2 h ago, ends at the next even 6-hour mark (≥ 1 h away). */
function flashWindow() {
  const now = nowMs();
  const six = 6 * 3600_000;
  let end = Math.ceil(now / six) * six;
  if (end - now < 3600_000) end += six;
  return { start: new Date(now - 2 * 3600_000).toISOString(), end: new Date(end).toISOString() };
}
const FLASH_DEFS = [
  { item: 71, variant: 401, sale: 59000, lowest: 85000, limit: 100, sold: 62, per: 1 },
  { item: 72, variant: 901, sale: 99000, lowest: 149000, limit: 50, sold: 41, per: 2 },
  { item: 73, variant: 1001, sale: 29000, lowest: 45000, limit: 200, sold: 88, per: 4 },
  { item: 74, variant: 302, sale: 89000, lowest: 115000, limit: 30, sold: 27, per: 1 },
];
function flashFor(variantId: number) {
  return FLASH_DEFS.find((f) => f.variant === variantId) ?? null;
}
function card(e: Entry): ProductCard {
  const p = e.product;
  const f = p.variants.map((v) => flashFor(v.id)).find(Boolean);
  const badges: string[] = [];
  if (p.variants.some((v) => BXGY.variants.includes(v.id))) badges.push(BXGY.label);
  const qb = QTY_BREAKS.find((q) => p.variants.some((v) => q.variants.includes(v.id)));
  if (qb) badges.push(`ราคาส่งเมื่อซื้อ ${qb.breaks[0].min} ชิ้นขึ้นไป`);
  const w = flashWindow();
  const { description, category, breadcrumbs, options, variants, images, reviews_summary, tags, seo, ...rest } = p;
  void description; void category; void breadcrumbs; void options; void variants; void images; void reviews_summary; void tags; void seo;
  return {
    ...rest,
    in_stock: p.variants.some((v) => (e.stock.get(v.id) ?? 0) > 0),
    flash: f
      ? {
          flash_sale_id: 7,
          sale_price_satang: f.sale,
          list_price_satang: byVariant.get(f.variant)!.v.price_satang,
          ends_at: w.end,
          remaining_qty: f.limit - f.sold,
          lowest_30d_satang: f.lowest,
        }
      : null,
    badges,
  };
}
function fullProduct(e: Entry): Product {
  return { ...e.product, ...card(e) };
}
function flashSales() {
  const w = flashWindow();
  const items: FlashSaleItem[] = FLASH_DEFS.map((f) => {
    const { e, v } = byVariant.get(f.variant)!;
    return {
      flash_sale_item_id: f.item,
      product: card(e),
      variant_id: v.id,
      variant_name: v.name,
      sale_price_satang: f.sale,
      list_price_satang: v.price_satang,
      lowest_30d_satang: f.lowest,
      qty_limit: f.limit,
      sold_qty: f.sold,
      remaining_qty: f.limit - f.sold,
      per_customer_limit: f.per,
    };
  });
  const current: FlashSale = { id: 7, label: "Flash Sale 11.11", starts_at: w.start, ends_at: w.end, items };
  const nextStart = new Date(new Date(w.end).getTime() + 18 * 3600_000);
  const next: FlashSale = {
    id: 8,
    label: "Flash Sale 12.12",
    starts_at: nextStart.toISOString(),
    ends_at: new Date(nextStart.getTime() + 12 * 3600_000).toISOString(),
    items: [],
  };
  return { current, next };
}
function campaign() {
  const c = structuredClone(campaignFx.data) as unknown as Campaign;
  const end = new Date(nowMs() + 26 * 3600_000).toISOString();
  c.ends_at = end;
  c.theme.hero_image_url = "/demo/hero-1111.svg";
  c.banners = c.banners.map((b) => ({ ...b, image_url: "/demo/hero-1111.svg" }));
  c.promo_codes = [
    { code: "1111SALE", label: "ลด 11% สูงสุด ฿200", description: "เมื่อช้อปครบ ฿500 ใช้ได้ทุกหมวด", ends_at: end },
    { code: "FREESHIP11", label: "ส่งฟรีทุกออเดอร์", description: "ไม่มีขั้นต่ำ ใช้ได้ 1 ครั้งต่อออเดอร์", ends_at: end },
    { code: "TRADE5", label: "ลูกค้าขายส่งลดเพิ่ม 5%", description: "เฉพาะสมาชิกกลุ่มลูกค้าขายส่ง ใช้ร่วมกับราคาส่งได้", ends_at: end },
  ];
  return c;
}
function banners() {
  const list = structuredClone(bannersFx.data);
  const imgs = ["/demo/hero-1111.svg", "/demo/banner-trade.svg"];
  return [
    ...list.map((b, i) => ({ ...b, image_url: imgs[i] ?? b.image_url, link_url: i === 1 ? "/c/shirts" : b.link_url })),
    {
      id: 3, placement: "home_hero", title: "ส่งฟรีเมื่อช้อปครบ ฿999", subtitle: "ทุกออเดอร์ทั่วไทย ด้วย Flash Express",
      cta_label: "ดูโปรทั้งหมด", link_url: "/promotions", image_url: "/demo/banner-ship.svg", image_mobile_url: "", image_alt: "ส่งฟรี", campaign_id: null,
    },
  ];
}

// ------------------------------------------------------------------ pricing (demo engine)
function layer1(variantId: number, qty: number, user: Me | null): { unit: number; source: PriceSource; lowest: number | null } {
  const { e, v } = byVariant.get(variantId)!;
  const list = v.price_satang;
  const cands: { unit: number; source: PriceSource; lowest: number | null }[] = [];
  const f = flashFor(variantId);
  if (f && f.sold + qty <= f.limit && qty <= f.per)
    cands.push({ unit: f.sale, source: { kind: "flash_sale", label: "Flash Sale 11.11", flash_sale_item_id: f.item }, lowest: f.lowest });
  if (user) {
    for (const q of QTY_BREAKS) {
      if (!q.variants.includes(variantId)) continue;
      const tier = [...q.breaks].reverse().find((b) => qty >= b.min);
      if (tier) {
        const unit = tier.unit ?? halfUp(list * (10000 - (tier.bp ?? 0)), 10000);
        cands.push({ unit, source: { kind: "quantity_break", label: q.label(tier.min), promotion_id: q.id }, lowest: list });
      }
    }
    if (user.tier === TIER_PROMO.tier && TIER_PROMO.cats.includes(e.product.category.slug))
      cands.push({
        unit: halfUp(list * (10000 - TIER_PROMO.bp), 10000),
        source: { kind: "tier_price", label: TIER_PROMO.label, promotion_id: TIER_PROMO.id },
        lowest: list,
      });
  }
  cands.sort((a, b) => a.unit - b.unit);
  return cands[0] && cands[0].unit < list ? cands[0] : { unit: list, source: { kind: "list", label: "" }, lowest: null };
}

function hashOf(x: unknown) {
  const s = JSON.stringify(x);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519);
  }
  return ((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")).repeat(4);
}

function allocate(amount: number, weights: { id: number; w: number }[]) {
  const total = weights.reduce((s, x) => s + x.w, 0);
  const out = new Map<number, number>();
  if (!total) return out;
  let used = 0;
  const rems = weights.map((x) => {
    const exact = amount * x.w;
    const base = Math.floor(exact / total);
    used += base;
    out.set(x.id, base);
    return { id: x.id, r: exact % total };
  });
  rems.sort((a, b) => b.r - a.r || a.id - b.id);
  for (let i = 0; i < amount - used; i++) out.set(rems[i].id, (out.get(rems[i].id) ?? 0) + 1);
  return out;
}

function priceCart(state: State, couponOverride?: string): Quote {
  const user = state.user;
  const lines: QuoteLine[] = state.cart
    .filter((i) => byVariant.has(i.variant_id))
    .map((i) => {
      const { e, v } = byVariant.get(i.variant_id)!;
      const stock = e.stock.get(v.id) ?? 0;
      const status = stock <= 0 ? "out_of_stock" : i.qty > stock ? "insufficient_stock" : "ok";
      const l1 = layer1(v.id, i.qty, user);
      const adjustments: Adjustment[] = [];
      if (BXGY.variants.includes(v.id) && l1.source.kind !== "flash_sale") {
        const free = Math.floor(i.qty / (BXGY.buy + BXGY.get)) * BXGY.get;
        if (free > 0) adjustments.push({ promotion_id: BXGY.id, layer: 2, label: BXGY.label, amount_satang: free * l1.unit });
      }
      const charged = status === "ok" ? i.qty : 0;
      return {
        variant_id: v.id,
        qty: i.qty,
        list_unit_price_satang: v.price_satang,
        unit_price_satang: l1.unit,
        price_source: l1.source,
        adjustments: status === "ok" ? adjustments : [],
        line_total_satang: charged * l1.unit - (status === "ok" ? adjustments.reduce((s, a) => s + a.amount_satang, 0) : 0),
        allocated_discount_satang: 0,
        lowest_30d_satang: l1.lowest,
        availability: { status, available_qty: Math.max(0, stock) },
      } satisfies QuoteLine;
    });
  const okLines = lines.filter((l) => l.availability.status === "ok");
  const listSubtotal = okLines.reduce((s, l) => s + l.qty * l.list_unit_price_satang, 0);
  const subtotal = okLines.reduce((s, l) => s + l.line_total_satang, 0);
  const catOf = (vid: number) => byVariant.get(vid)!.e.product.breadcrumbs.map((b) => b.slug);

  // layer 3
  const eligible3 = okLines.filter((l) => catOf(l.variant_id).some((c) => CART_AUTO.cats.includes(c)));
  const elig3Sub = eligible3.reduce((s, l) => s + l.line_total_satang, 0);
  let auto: { adj: Adjustment; lines: QuoteLine[] } | null =
    elig3Sub >= CART_AUTO.min
      ? { adj: { promotion_id: CART_AUTO.id, layer: 3, label: CART_AUTO.label, amount_satang: Math.min(CART_AUTO.amount, elig3Sub) }, lines: eligible3 }
      : null;

  // layer 4
  const raw = (couponOverride ?? state.coupon ?? "").trim().toUpperCase();
  let coupon: CouponState | null = null;
  let code: { adj: Adjustment; lines: QuoteLine[] } | null = null;
  let freeShipCode: Code | null = null;
  const bad = (status: CouponState["status"], reason: CouponReason, message: string) => {
    coupon = { code: raw, status, reason_code: reason, message };
  };
  if (raw) {
    const c = CODES.find((x) => x.code === raw);
    if (!c) bad("invalid", "not_found", `ไม่พบโค้ด ${raw} กรุณาตรวจสอบอีกครั้ง`);
    else if (c.state === "expired") bad("invalid", "expired", `โค้ด ${raw} หมดอายุแล้ว (สิ้นสุด ${c.endText})`);
    else if (c.state === "not_started") bad("invalid", "not_started", `โค้ด ${raw} ยังไม่เริ่มใช้งาน เริ่ม 1 ม.ค. 2027`);
    else if (c.state === "usage_limit_reached") bad("invalid", "usage_limit_reached", `โค้ด ${raw} ถูกใช้ครบจำนวนแล้ว`);
    else if (c.login && !user) bad("invalid", "login_required", `เข้าสู่ระบบเพื่อใช้โค้ด ${raw}`);
    else if (c.group && user?.group?.code !== c.group) bad("not_applied", "not_eligible_audience", `โค้ด ${raw} ใช้ได้เฉพาะลูกค้าขายส่ง`);
    else if (c.min && subtotal < c.min) bad("not_applied", "min_spend_not_met", `โค้ด ${raw} ใช้ได้เมื่อช้อปครบ ${thb(c.min)} (ขาดอีก ${thb(c.min - subtotal)})`);
    else if (c.kind === "free_shipping") freeShipCode = c;
    else {
      const elig = c.code === "BAGS15" ? okLines.filter((l) => catOf(l.variant_id).includes("bags")) : okLines;
      const base = elig.reduce((s, l) => s + l.line_total_satang, 0);
      if (!base) bad("not_applied", "no_eligible_items", `ไม่มีสินค้าในตะกร้าที่ร่วมรายการกับโค้ด ${raw}`);
      else {
        let amt = c.kind === "percent" ? halfUp(base * c.value, 10000) : Math.min(c.value, base);
        if (c.max) amt = Math.min(amt, c.max);
        const adj: Adjustment = { promotion_id: c.id, layer: 4, label: c.label, amount_satang: amt, coupon_code: c.code };
        if (c.exclusive && auto) {
          if (amt > auto.adj.amount_satang) {
            auto = null;
            code = { adj, lines: elig };
          } else
            bad("not_applied", "exclusive_not_better", `โค้ด ${raw} ใช้ร่วมกับโปรอื่นไม่ได้ และลดน้อยกว่าโปร '${auto.adj.label}' ที่ได้รับอยู่แล้ว`);
        } else code = { adj, lines: elig };
        if (code) coupon = { code: raw, status: "applied", reason_code: "", message: `ใช้โค้ด ${raw} แล้ว ลด ${thb(amt)}` };
      }
    }
  }
  const adjustments = [auto, code].filter(Boolean) as { adj: Adjustment; lines: QuoteLine[] }[];
  for (const a of adjustments) {
    const alloc = allocate(a.adj.amount_satang, a.lines.map((l) => ({ id: l.variant_id, w: l.line_total_satang })));
    for (const l of lines) l.allocated_discount_satang += alloc.get(l.variant_id) ?? 0;
  }
  const discount = adjustments.reduce((s, a) => s + a.adj.amount_satang, 0);
  const fee = okLines.length ? SHIP_FEE : 0;
  let shipping: Quote["shipping"] = { fee_satang: fee, discount_satang: 0 };
  const autoFree = fee > 0 && subtotal >= FREE_SHIP_MIN;
  if (autoFree) shipping = { fee_satang: fee, discount_satang: fee, promotion_id: 31, label: "ส่งฟรีเมื่อช้อปครบ ฿999" };
  const fsc = freeShipCode as Code | null;
  if (fsc) {
    if (autoFree) bad("not_applied", "shipping_already_free", `ออเดอร์นี้ส่งฟรีอยู่แล้ว ไม่ต้องใช้โค้ด ${raw}`);
    else if (fee > 0) {
      shipping = { fee_satang: fee, discount_satang: fee, promotion_id: fsc.id, label: fsc.label };
      coupon = { code: raw, status: "applied", reason_code: "", message: `ใช้โค้ด ${raw} แล้ว ส่งฟรี` };
    }
  }
  const shipNet = shipping.fee_satang - shipping.discount_satang;
  const hints: Hint[] = [];
  if (fee > 0 && shipping.discount_satang === 0 && subtotal < FREE_SHIP_MIN)
    hints.push({ kind: "free_shipping_gap", message: `ช้อปเพิ่มอีก ${thb(FREE_SHIP_MIN - subtotal)} รับส่งฟรี`, amount_satang: FREE_SHIP_MIN - subtotal, promotion_id: 31 });
  if (!auto && elig3Sub > 0 && elig3Sub < CART_AUTO.min)
    hints.push({ kind: "cart_promo_gap", message: `ช้อปอิเล็กทรอนิกส์เพิ่มอีก ${thb(CART_AUTO.min - elig3Sub)} รับส่วนลด ฿150`, amount_satang: CART_AUTO.min - elig3Sub, promotion_id: CART_AUTO.id });
  for (const l of okLines)
    if (BXGY.variants.includes(l.variant_id) && l.qty % 3 === 2)
      hints.push({ kind: "buy_x_get_y_gap", message: "เพิ่มถุงเท้าอีก 1 คู่ รับฟรี 1 คู่ (ซื้อ 2 แถม 1)", promotion_id: BXGY.id });
  if (user)
    for (const l of okLines) {
      const qb = QTY_BREAKS.find((x) => x.variants.includes(l.variant_id));
      const next = qb?.breaks.find((b) => b.min > l.qty);
      const listU = l.list_unit_price_satang;
      const nextUnit = next ? (next.unit ?? halfUp(listU * (10000 - (next.bp ?? 0)), 10000)) : 0;
      if (qb && next && next.min - l.qty <= 5 && nextUnit < l.unit_price_satang) {
        const add = next.min - l.qty;
        const what = next.bp ? `ลด ${next.bp / 100}%` : `฿${(next.unit ?? 0) / 100}/ชิ้น`;
        hints.push({
          kind: "quantity_break_gap",
          message: `เพิ่มอีก ${add} ชิ้น รับราคาส่ง ${what}`,
          promotion_id: qb.id,
          variant_id: l.variant_id,
          qty_needed: add,
        });
      }
    }
  if (!user) hints.push({ kind: "login_for_member_price", message: "เข้าสู่ระบบเพื่อดูราคาสมาชิก" });

  const totals: Quote["totals"] = {
    list_subtotal_satang: listSubtotal,
    subtotal_satang: subtotal,
    discount_satang: discount,
    shipping_satang: shipNet,
    savings_satang: listSubtotal - subtotal + discount + shipping.discount_satang,
    grand_total_satang: subtotal - discount + shipNet,
  };
  const body = { lines, adjustments: adjustments.map((a) => a.adj), shipping, totals, coupon, hints };
  return { ...body, quote_hash: hashOf(body), expires_at: new Date(nowMs() + 600_000).toISOString() };
}

function cartOf(state: State): Cart {
  const items: CartItem[] = state.cart
    .filter((i) => byVariant.has(i.variant_id))
    .map((i) => {
      const { e, v } = byVariant.get(i.variant_id)!;
      const image = e.product.images.find((im) => im.id === v.image_id) ?? e.product.image;
      const stock = e.stock.get(v.id) ?? 0;
      return {
        variant_id: v.id,
        qty: i.qty,
        product: { id: e.product.id, slug: e.product.slug, name: e.product.name, image },
        variant: { sku: v.sku, name: v.name, option_values: v.option_values },
        list_unit_price_satang: v.price_satang,
        stock_level: stockLevel(stock),
        max_qty: Math.min(999, Math.max(0, stock), flashFor(v.id)?.per ?? 999),
      };
    });
  return { items, coupon_code: state.coupon, item_count: items.reduce((s, i) => s + i.qty, 0), quote: priceCart(state) };
}

function offersFor(ids: number[], user: Me | null): Offer[] {
  return ids
    .filter((id) => byVariant.has(id))
    .map((id) => {
      const { v } = byVariant.get(id)!;
      const l1 = layer1(id, 1, user);
      const qb = user ? QTY_BREAKS.find((q) => q.variants.includes(id)) : undefined;
      const breaks = qb
        ? qb.breaks.map((b) => ({ min_qty: b.min, unit_price_satang: b.unit ?? halfUp(v.price_satang * (10000 - (b.bp ?? 0)), 10000) }))
        : [];
      const badges = qb ? [`ราคาส่งเมื่อซื้อ ${qb.breaks[0].min} ชิ้นขึ้นไป`] : [];
      return {
        variant_id: id,
        list_price_satang: v.price_satang,
        price_satang: l1.unit,
        price_source: { kind: l1.source.kind, label: l1.source.label },
        lowest_30d_satang: l1.lowest,
        qty_breaks: breaks,
        badges,
      };
    });
}

// ------------------------------------------------------------------ catalog queries
function norm(s: string) {
  return s.toLowerCase().normalize("NFC");
}
function bigrams(s: string) {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function matchScore(q: string, e: Entry) {
  const p = e.product;
  const text = norm([p.name, p.name_en, p.subtitle, p.brand, ...p.tags, ...p.variants.map((v) => v.sku)].join(" "));
  const nq = norm(q.trim());
  if (!nq) return 1;
  if (text.includes(nq)) return 2;
  const qb = bigrams(nq);
  if (!qb.size) return 0;
  const tb = bigrams(text);
  let hit = 0;
  qb.forEach((b) => tb.has(b) && hit++);
  const sim = hit / qb.size;
  return sim >= 0.5 ? sim : 0;
}
function listProducts(q: Query = {}) {
  const cat = q.category ? String(q.category) : "";
  const catSlugs = cat ? new Set([cat, ...(catIndex.get(cat)?.cat.children.map((c) => c.slug) ?? [])]) : null;
  let rows = PRODUCTS.map((e) => ({ e, c: card(e), s: q.q ? matchScore(String(q.q), e) : 1 })).filter((r) => r.s > 0);
  if (catSlugs) rows = rows.filter((r) => r.e.product.breadcrumbs.some((b) => catSlugs.has(b.slug)));
  if (q.min_price) rows = rows.filter((r) => r.c.min_price_satang >= Number(q.min_price));
  if (q.max_price) rows = rows.filter((r) => r.c.min_price_satang <= Number(q.max_price));
  if (q.rating_min) rows = rows.filter((r) => r.c.rating_avg >= Number(q.rating_min));
  if (String(q.in_stock) === "true") rows = rows.filter((r) => r.c.in_stock);
  if (String(q.on_sale) === "true") rows = rows.filter((r) => r.c.flash || r.c.badges.length);
  if (q.tag) rows = rows.filter((r) => r.e.product.tags.includes(String(q.tag)));
  const sort = String(q.sort ?? (q.q ? "relevance" : "newest"));
  const price = (r: (typeof rows)[number]) => r.c.flash?.sale_price_satang ?? r.c.min_price_satang;
  rows.sort((a, b) => {
    switch (sort) {
      case "price_asc": return price(a) - price(b) || a.c.id - b.c.id;
      case "price_desc": return price(b) - price(a) || a.c.id - b.c.id;
      case "best_selling": return b.c.sold_count - a.c.sold_count;
      case "rating": return b.c.rating_avg - a.c.rating_avg || b.c.rating_count - a.c.rating_count;
      case "relevance": return b.s - a.s || b.c.sold_count - a.c.sold_count;
      default: return a.e.age - b.e.age;
    }
  });
  const per = Math.min(48, Math.max(1, Number(q.per_page ?? 24)));
  const page = Math.max(1, Number(q.page ?? 1));
  const total = rows.length;
  return {
    data: rows.slice((page - 1) * per, page * per).map((r) => r.c),
    meta: { page, per_page: per, total, total_pages: Math.max(1, Math.ceil(total / per)) },
  };
}
function categoriesTree() {
  const tree = structuredClone(categoriesFx.data) as unknown as Category[];
  const count = (slug: string) => PRODUCTS.filter((e) => e.product.breadcrumbs.some((b) => b.slug === slug)).length;
  for (const c of tree) {
    c.product_count = count(c.slug);
    for (const ch of c.children) ch.product_count = count(ch.slug);
  }
  return tree;
}

// ------------------------------------------------------------------ orders / payments
function orderNo() {
  const d = new Date(nowMs() + 7 * 3600_000);
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, "");
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `SS${ymd}${s}`;
}
function summary(o: Order): OrderSummary {
  const first = o.items[0];
  return {
    order_no: o.order_no,
    status: o.status,
    item_count: o.items.reduce((s, i) => s + i.qty, 0),
    grand_total_satang: o.totals.grand_total_satang,
    created_at: o.created_at,
    first_item_image: first ? { id: 0, url: first.image_url.replace("/mock/", "/demo/"), alt: first.product_name, width: 800, height: 800 } : null,
  };
}
function promptpayPayload(o: Order) {
  // EMVCo-shaped demo payload (not a real PromptPay account).
  const amt = (o.totals.grand_total_satang / 100).toFixed(2);
  return `00020101021230570016A000000677010112011501055600000000002150${o.order_no}5303764540${amt.length}${amt}5802TH6304ABCD`;
}
function markPaid(state: State, o: Order, method: string) {
  if (o.status !== "pending_payment") return;
  const at = new Date(nowMs()).toISOString();
  o.status = "paid";
  o.paid_at = at;
  o.timeline.push({ status: "paid", at, note: method === "card" ? "บัตรเครดิต (TEST)" : "PromptPay" });
  if (o.payment) o.payment.status = "successful";
  void state;
}

const err = (status: number, code: Parameters<typeof makeErr>[1], message: string, extra?: object) => makeErr(status, code, message, extra);
function makeErr(status: number, code: ConstructorParameters<typeof ApiError>[1]["code"], message: string, extra?: object): never {
  throw new ApiError(status, { code, message, ...(extra ?? {}) });
}
function requireUser(state: State) {
  if (!state.user) err(401, "unauthorized", "กรุณาเข้าสู่ระบบ");
  return state.user!;
}
const ok = <T>(data: T) => ({ data });

// ------------------------------------------------------------------ router
export async function storefrontMock(
  method: string,
  path: string,
  query?: Query,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<unknown | undefined> {
  const s = load();
  const b = (body ?? {}) as Record<string, unknown>;
  let m: RegExpMatchArray | null;
  const route = (verb: string, re: RegExp) => method === verb && (m = path.match(re)) !== null;

  // ---- catalog
  if (route("GET", /^\/categories$/)) return ok(categoriesTree());
  if (route("GET", /^\/categories\/([^/]+)$/)) {
    const slug = decodeURIComponent(m![1]);
    const ref = catIndex.get(slug);
    if (!ref) err(404, "not_found", "ไม่พบหมวดหมู่");
    const tree = categoriesTree();
    const found = tree.flatMap((c) => [c, ...c.children]).find((c) => c.slug === slug)!;
    return ok({ ...found, breadcrumbs: [ref!.parent, ref!.cat].filter(Boolean).map((c) => ({ id: c!.id, slug: c!.slug, name: c!.name })) });
  }
  if (route("GET", /^\/products$/)) return listProducts(query);
  if (route("GET", /^\/products\/([^/]+)\/reviews$/)) {
    const e = bySlug.get(decodeURIComponent(m![1]));
    if (!e) err(404, "not_found", "ไม่พบสินค้า");
    if (!e!.product.rating_count) return { data: [], meta: { page: 1, per_page: 10, total: 0, total_pages: 1 } };
    const base = reviewsFx.data as unknown as Review[];
    const extra: Review[] = [
      { id: 903, rating: 5, title: "คุ้มมาก", body: "ของถึงไว แพ็กมาดี ใช้งานได้ตามที่บอกเลยค่ะ", author_name: "น***ย", variant_name: e!.product.variants[0]?.name ?? "", images: [], created_at: "2026-10-28T09:00:00Z", reply: null },
      { id: 904, rating: 4, title: "", body: "คุณภาพดีเกินราคา จะกลับมาซื้ออีก", author_name: "K***t", variant_name: e!.product.variants[0]?.name ?? "", images: [], created_at: "2026-10-20T12:30:00Z", reply: null },
      { id: 905, rating: 3, title: "พอใช้", body: "โดยรวมโอเค แต่สีจริงเข้มกว่าในรูปนิดหน่อย", author_name: "ม***า", variant_name: e!.product.variants.at(-1)?.name ?? "", images: [], created_at: "2026-10-11T07:10:00Z", reply: { body: "ขอบคุณสำหรับคำติชมค่ะ ร้านจะปรับรูปให้ตรงขึ้น", replied_at: "2026-10-11T10:00:00Z" } },
    ];
    let all = [...base.map((r) => ({ ...r, images: r.images.map((i) => ({ ...i, url: i.url.replace("/mock/", "/demo/") })) })), ...extra];
    if (query?.rating) all = all.filter((r) => r.rating === Number(query.rating));
    if (String(query?.with_images) === "true") all = all.filter((r) => r.images.length);
    return { data: all, meta: { page: 1, per_page: 10, total: all.length, total_pages: 1 } };
  }
  if (route("GET", /^\/products\/([^/]+)\/related$/)) {
    const e = bySlug.get(decodeURIComponent(m![1]));
    if (!e) err(404, "not_found", "ไม่พบสินค้า");
    const top = e!.product.breadcrumbs[0]?.slug;
    return ok(
      PRODUCTS.filter((x) => x !== e && x.product.breadcrumbs[0]?.slug === top)
        .concat(PRODUCTS.filter((x) => x !== e && x.product.breadcrumbs[0]?.slug !== top))
        .slice(0, 8)
        .map(card),
    );
  }
  if (route("GET", /^\/products\/([^/]+)$/)) {
    const e = bySlug.get(decodeURIComponent(m![1]));
    if (!e) err(404, "not_found", "ไม่พบสินค้า");
    return ok(fullProduct(e!));
  }
  if (route("GET", /^\/search\/suggest$/)) {
    const q = String(query?.q ?? "");
    const list = listProducts({ q, sort: "relevance", per_page: 8 }).data;
    const cats = [...catIndex.values()].filter((c) => q && norm(c.cat.name).includes(norm(q))).slice(0, 8);
    return ok({
      products: list.map((p) => ({ slug: p.slug, name: p.name, image_url: p.image?.url ?? "" })),
      categories: cats.map((c) => ({ id: c.cat.id, slug: c.cat.slug, name: c.cat.name })),
    });
  }
  if (route("GET", /^\/campaigns\/active$/)) return ok(campaign());
  if (route("GET", /^\/banners$/)) return ok(banners().filter((x) => !query?.placement || x.placement === query.placement));
  if (route("GET", /^\/flash-sales\/current$/)) return ok(flashSales());
  if (route("GET", /^\/offers$/)) {
    const ids = String(query?.variant_ids ?? "").split(",").map(Number).filter(Boolean);
    return ok(offersFor(ids, s.user));
  }

  // ---- auth
  if (route("GET", /^\/auth\/me$/)) {
    if (!s.user) {
      if (String(query?.optional) === "true") return ok(null);
      err(401, "unauthorized", "กรุณาเข้าสู่ระบบ");
    }
    return ok(s.user);
  }
  if (route("POST", /^\/auth\/login$/)) {
    if (String(b.password ?? "").length < 8) err(401, "unauthorized", "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    s.user = { ...(meFx.data as unknown as Me), email: String(b.email) };
    save();
    return ok(s.user);
  }
  if (route("POST", /^\/auth\/register$/)) {
    const fields: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(String(b.email ?? ""))) fields.email = "อีเมลไม่ถูกต้อง";
    if (String(b.password ?? "").length < 8) fields.password = "รหัสผ่านอย่างน้อย 8 ตัวอักษร";
    if (!String(b.name ?? "").trim()) fields.name = "กรุณากรอกชื่อ";
    if (Object.keys(fields).length) err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", { fields });
    if (String(b.email).toLowerCase() === "taken@example.com") err(409, "conflict", "อีเมลนี้ถูกใช้สมัครแล้ว");
    s.user = {
      ...(meFx.data as unknown as Me),
      id: 777, email: String(b.email), name: String(b.name), phone: String(b.phone ?? ""), tier: "standard", group: null,
      marketing_consent: Boolean(b.marketing_consent), email_verified: false, created_at: new Date(nowMs()).toISOString(),
    };
    save();
    return ok(s.user);
  }
  if (route("POST", /^\/auth\/logout$/)) {
    s.user = null;
    save();
    return { data: undefined };
  }
  if (route("PATCH", /^\/auth\/me$/)) {
    const u = requireUser(s);
    s.user = { ...u, ...(b as Partial<Me>) };
    save();
    return ok(s.user);
  }
  if (route("POST", /^\/auth\/password\/(change|forgot|reset)$/)) {
    if (m![1] === "change") requireUser(s);
    if (m![1] === "reset" && String(b.new_password ?? "").length < 8)
      err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", { fields: { new_password: "รหัสผ่านอย่างน้อย 8 ตัวอักษร" } });
    return { data: undefined };
  }

  // ---- cart
  if (route("GET", /^\/cart$/)) return ok(cartOf(s));
  if (route("POST", /^\/cart\/items$/)) {
    const vid = Number(b.variant_id);
    const qty = Math.max(1, Number(b.qty ?? 1));
    const hit = byVariant.get(vid);
    if (!hit) err(404, "not_found", "ไม่พบสินค้า");
    const stock = hit!.e.stock.get(vid) ?? 0;
    const line = s.cart.find((i) => i.variant_id === vid);
    const next = (line?.qty ?? 0) + qty;
    if (next > stock) err(409, "out_of_stock", stock > 0 ? `สินค้าเหลือเพียง ${stock} ชิ้น` : "สินค้าหมดแล้ว", { details: { variant_ids: [vid] } });
    if (line) line.qty = next;
    else s.cart.push({ variant_id: vid, qty });
    save();
    return ok(cartOf(s));
  }
  if (route("PATCH", /^\/cart\/items\/(\d+)$/)) {
    const vid = Number(m![1]);
    const line = s.cart.find((i) => i.variant_id === vid);
    if (!line) err(404, "not_found", "ไม่พบสินค้าในตะกร้า");
    line!.qty = Math.min(999, Math.max(1, Number(b.qty)));
    save();
    return ok(cartOf(s));
  }
  if (route("DELETE", /^\/cart\/items\/(\d+)$/)) {
    s.cart = s.cart.filter((i) => i.variant_id !== Number(m![1]));
    save();
    return ok(cartOf(s));
  }
  if (route("PUT", /^\/cart\/coupon$/)) {
    s.coupon = String(b.code ?? "").trim().toUpperCase() || null;
    save();
    return ok(cartOf(s));
  }
  if (route("DELETE", /^\/cart\/coupon$/)) {
    s.coupon = null;
    save();
    return ok(cartOf(s));
  }
  if (route("POST", /^\/cart\/quote$/)) {
    const q = priceCart(s, typeof b.coupon_code === "string" && b.coupon_code ? b.coupon_code : undefined);
    if (!b.postal_code && !b.address_id) return ok(q);
    return ok(q);
  }

  // ---- account
  if (route("GET", /^\/me\/addresses$/)) {
    requireUser(s);
    return ok([...s.addresses].sort((a, c) => Number(c.is_default) - Number(a.is_default)));
  }
  if (route("POST", /^\/me\/addresses$/)) {
    requireUser(s);
    const fields: Record<string, string> = {};
    if (!/^[1-9][0-9]{4}$/.test(String(b.postal_code ?? ""))) fields.postal_code = "รหัสไปรษณีย์ 5 หลัก";
    const digits = String(b.phone ?? "").replace(/[\s-]/g, "");
    if (!/^\d{9,15}$/.test(digits)) fields.phone = "เบอร์โทร 9–15 หลัก";
    for (const k of ["recipient_name", "line1", "subdistrict", "district", "province"])
      if (!String(b[k] ?? "").trim()) fields[k] = "จำเป็นต้องกรอก";
    if (Object.keys(fields).length) err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", { fields });
    const id = Math.max(0, ...s.addresses.map((a) => a.id)) + 1;
    const makeDefault = Boolean(b.is_default) || s.addresses.length === 0;
    if (makeDefault) s.addresses.forEach((a) => (a.is_default = false));
    const a = { ...(b as unknown as Address), id, country: "TH" as const, is_default: makeDefault, line2: String(b.line2 ?? ""), label: String(b.label ?? "") };
    s.addresses.push(a);
    save();
    return ok(a);
  }
  if (route("PATCH", /^\/me\/addresses\/(\d+)$/)) {
    requireUser(s);
    const a = s.addresses.find((x) => x.id === Number(m![1]));
    if (!a) err(404, "not_found", "ไม่พบที่อยู่");
    Object.assign(a!, b);
    save();
    return ok(a);
  }
  if (route("DELETE", /^\/me\/addresses\/(\d+)$/)) {
    requireUser(s);
    s.addresses = s.addresses.filter((x) => x.id !== Number(m![1]));
    if (s.addresses.length && !s.addresses.some((a) => a.is_default)) s.addresses[0].is_default = true;
    save();
    return { data: undefined };
  }
  if (route("POST", /^\/me\/addresses\/(\d+)\/default$/)) {
    requireUser(s);
    s.addresses.forEach((a) => (a.is_default = a.id === Number(m![1])));
    save();
    return ok(s.addresses.find((a) => a.is_default));
  }
  if (route("GET", /^\/me\/wishlist$/)) {
    requireUser(s);
    const list = s.wishlist.map((id) => PRODUCTS.find((e) => e.product.id === id)).filter(Boolean).map((e) => card(e!));
    return { data: list, meta: { page: 1, per_page: 48, total: list.length, total_pages: 1 } };
  }
  if (route("PUT", /^\/me\/wishlist\/(\d+)$/)) {
    requireUser(s);
    const id = Number(m![1]);
    if (!s.wishlist.includes(id)) s.wishlist.unshift(id);
    save();
    return { data: undefined };
  }
  if (route("DELETE", /^\/me\/wishlist\/(\d+)$/)) {
    requireUser(s);
    s.wishlist = s.wishlist.filter((x) => x !== Number(m![1]));
    save();
    return { data: undefined };
  }

  // ---- shipping
  if (route("POST", /^\/shipping\/quote$/)) {
    const pc = String(b.postal_code ?? "");
    const remote = /^(5[0-8]|6[0-7]|8[0-6]|9[0-6])/.test(pc);
    return ok({ carrier: "flash_mock", fee_satang: SHIP_FEE, eta_days: remote ? [2, 5] : [1, 3] });
  }

  // ---- orders
  if (route("POST", /^\/orders$/)) {
    const u = requireUser(s);
    const addr = s.addresses.find((a) => a.id === Number(b.address_id));
    if (!addr) err(422, "validation_failed", "กรุณาเลือกที่อยู่จัดส่ง", { fields: { address_id: "กรุณาเลือกที่อยู่" } });
    const q = priceCart(s, typeof b.coupon_code === "string" ? b.coupon_code : undefined);
    if (q.lines.some((l) => l.availability.status !== "ok")) err(409, "out_of_stock", "มีสินค้าบางรายการหมด", { details: { variant_ids: q.lines.filter((l) => l.availability.status !== "ok").map((l) => l.variant_id) } });
    const forceChange =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mock_price_changed") === "1" && !s.priceChangedOnce;
    if (forceChange || q.quote_hash !== b.quote_hash) {
      s.priceChangedOnce = true;
      save();
      err(409, "price_changed", "ราคามีการเปลี่ยนแปลง กรุณาตรวจสอบอีกครั้ง", { details: { quote: q } });
    }
    const idem = headers?.["Idempotency-Key"];
    const dup = s.orders.find((o) => (o as Order & { _idem?: string })._idem === idem);
    if (dup) return ok(dup);
    const at = new Date(nowMs()).toISOString();
    const due = new Date(nowMs() + 15 * 60_000).toISOString();
    const lineAdj = q.lines.flatMap((l) => l.adjustments);
    const order: Order & { _idem?: string } = {
      _idem: idem,
      order_no: orderNo(),
      status: "pending_payment",
      items: q.lines.map((l) => {
        const { e, v } = byVariant.get(l.variant_id)!;
        const im = e.product.images.find((i) => i.id === v.image_id) ?? e.product.image;
        return {
          variant_id: v.id, product_slug: e.product.slug, sku: v.sku, product_name: e.product.name, variant_name: v.name,
          image_url: im?.url ?? "", qty: l.qty, list_unit_price_satang: l.list_unit_price_satang, unit_price_satang: l.unit_price_satang,
          price_source: { kind: l.price_source.kind, label: l.price_source.label },
          line_discount_satang: l.adjustments.reduce((x, a) => x + a.amount_satang, 0), line_total_satang: l.line_total_satang,
          allocated_discount_satang: l.allocated_discount_satang, lowest_30d_satang: l.lowest_30d_satang,
        };
      }),
      adjustments: [...lineAdj, ...q.adjustments],
      totals: {
        list_subtotal_satang: q.totals.list_subtotal_satang, subtotal_satang: q.totals.subtotal_satang, discount_satang: q.totals.discount_satang,
        shipping_fee_satang: q.shipping.fee_satang, shipping_discount_satang: q.shipping.discount_satang, savings_satang: q.totals.savings_satang,
        grand_total_satang: q.totals.grand_total_satang,
      },
      coupon_code: q.coupon?.status === "applied" ? q.coupon.code : null,
      payment_method: b.payment_method === "card" ? "card" : "promptpay",
      shipping_address: { ...addr! },
      email: u.email,
      customer_note: String(b.customer_note ?? ""),
      payment: null,
      shipment: null,
      timeline: [{ status: "pending_payment", at, note: "" }],
      payment_due_at: due,
      paid_at: null,
      cancelled_at: null,
      created_at: at,
    };
    s.orders.unshift(order);
    s.cart = [];
    s.coupon = null;
    save();
    return ok(order);
  }
  if (route("GET", /^\/orders$/)) {
    requireUser(s);
    const list = s.orders.filter((o) => !query?.status || o.status === query.status).map(summary);
    return { data: list, meta: { page: 1, per_page: 24, total: list.length, total_pages: 1 } };
  }
  if (route("GET", /^\/orders\/([^/]+)\/tracking$/)) {
    requireUser(s);
    const o = s.orders.find((x) => x.order_no === decodeURIComponent(m![1]));
    if (!o?.shipment) err(404, "not_found", "ยังไม่มีข้อมูลพัสดุ");
    return ok({ carrier: o!.shipment!.carrier, tracking_no: o!.shipment!.tracking_no, status: o!.shipment!.status, events: [] });
  }
  if (route("POST", /^\/orders\/([^/]+)\/cancel$/)) {
    requireUser(s);
    const o = s.orders.find((x) => x.order_no === decodeURIComponent(m![1]));
    if (!o) err(404, "not_found", "ไม่พบคำสั่งซื้อ");
    if (o!.status !== "pending_payment") err(409, "invalid_state", "ยกเลิกได้เฉพาะคำสั่งซื้อที่รอชำระเงิน");
    const at = new Date(nowMs()).toISOString();
    o!.status = "cancelled";
    o!.cancelled_at = at;
    o!.timeline.push({ status: "cancelled", at, note: "ลูกค้ายกเลิก" });
    save();
    return ok(o);
  }
  if (route("GET", /^\/orders\/([^/]+)$/)) {
    requireUser(s);
    const o = s.orders.find((x) => x.order_no === decodeURIComponent(m![1]));
    if (!o) err(404, "not_found", "ไม่พบคำสั่งซื้อ");
    if (o!.order_no === "SS261117A7K2" && !o!.shipment) {
      o!.status = "shipped";
      o!.shipment = { carrier: "flash_mock", tracking_no: "TH0123456789MK", status: "in_transit" };
      if (!o!.timeline.some((t) => t.status === "packing"))
        o!.timeline.push({ status: "packing", at: "2026-11-17T05:10:00Z", note: "" }, { status: "shipped", at: "2026-11-17T09:30:00Z", note: "Flash Express" });
    }
    return ok({ ...o!, items: o!.items.map((i) => ({ ...i, image_url: i.image_url.replace("/mock/", "/demo/") })) });
  }

  // ---- payments
  if (route("POST", /^\/payments\/charges$/)) {
    requireUser(s);
    const o = s.orders.find((x) => x.order_no === String(b.order_no));
    if (!o) err(404, "not_found", "ไม่พบคำสั่งซื้อ");
    if (o!.status !== "pending_payment") err(409, "invalid_state", "คำสั่งซื้อนี้ชำระเงินแล้วหรือถูกยกเลิก");
    const method = b.method === "card" ? "card" : "promptpay";
    const open = Object.values(s.charges).find((c) => c.order_no === o!.order_no && c.method === method && (c.status === "pending" || c.status === "requires_action"));
    if (open && method === "promptpay") return ok(open);
    const id = `chrg_mock_${o!.order_no.slice(-4).toLowerCase()}${Object.keys(s.charges).length}`;
    const expires = new Date(Math.min(new Date(o!.payment_due_at).getTime(), nowMs() + 15 * 60_000)).toISOString();
    const token = String(b.card_token ?? "");
    const ch: Charge = {
      charge_id: id,
      order_no: o!.order_no,
      method,
      status: method === "promptpay" ? "pending" : token === "tokn_test_success" ? "successful" : token === "tokn_test_failure" ? "failed" : "requires_action",
      amount_satang: o!.totals.grand_total_satang,
      promptpay: method === "promptpay" ? { qr_payload: promptpayPayload(o!), qr_image_url: null, expires_at: expires } : null,
      authorize_uri: method === "card" && token !== "tokn_test_success" && token !== "tokn_test_failure" ? `${String(b.return_uri ?? "/")}${String(b.return_uri ?? "").includes("?") ? "&" : "?"}mock_3ds=${id}` : null,
      failure_code: token === "tokn_test_failure" ? "payment_rejected" : null,
      failure_message: token === "tokn_test_failure" ? "บัตรถูกปฏิเสธ (วงเงินไม่พอ) — บัตรทดสอบ" : null,
    };
    s.charges[id] = ch;
    o!.payment = { status: ch.status, method, charge_id: id, expires_at: ch.promptpay?.expires_at ?? null };
    o!.payment_method = method;
    if (ch.status === "successful") markPaid(s, o!, method);
    save();
    return ok(ch);
  }
  if (route("GET", /^\/payments\/charges\/([^/]+)$/)) {
    const ch = s.charges[decodeURIComponent(m![1])];
    if (!ch) err(404, "not_found", "ไม่พบรายการชำระเงิน");
    if (ch!.status === "pending" && ch!.promptpay && new Date(ch!.promptpay.expires_at).getTime() < nowMs()) {
      ch!.status = "expired";
      save();
    }
    return ok(ch);
  }
  if (route("POST", /^\/payments\/mock\/charges\/([^/]+)\/complete$/)) {
    const ch = s.charges[decodeURIComponent(m![1])];
    if (!ch) err(404, "not_found", "ไม่พบรายการชำระเงิน");
    if (ch!.status === "pending" || ch!.status === "requires_action") {
      ch!.status = b.outcome === "failed" ? "failed" : "successful";
      if (ch!.status === "failed") {
        ch!.failure_code = "payment_rejected";
        ch!.failure_message = "การชำระเงินถูกปฏิเสธ (จำลอง)";
      }
      const o = s.orders.find((x) => x.order_no === ch!.order_no);
      if (o?.payment) o.payment.status = ch!.status;
      if (o && ch!.status === "successful") markPaid(s, o, ch!.method);
      save();
    }
    return ok(ch);
  }
  return undefined;
}
