/**
 * Stateful in-memory mock of /api/v1/admin/* for NEXT_PUBLIC_USE_MOCKS=true.
 * Seeded from docs/fixtures (synced into src/mocks/fixtures) plus generated
 * demo data. State lives for the browser tab (reload = reset). Synchronous on
 * purpose: web/src/mocks/handler.ts structuredClones the return value.
 * Owner: admin agent. Never imported in production paths (dynamic import behind USE_MOCKS).
 */
import { ApiError, type Query } from "@/lib/api/client";
import type {
  AdminBanner,
  AdminCampaign,
  AdminCategory,
  AdminFlashSale,
  AdminOrder,
  AdminProduct,
  AdminReview,
  AdminUser,
  AdminVariant,
  AuditLog,
  CustomerGroup,
  InventoryRow,
  PreviewRequest,
} from "@/lib/api/admin";
import type {
  Adjustment,
  AdminOrderRow,
  AdminProductRow,
  AdminPromotion,
  Dashboard,
  Image,
  Me,
  OrderStatus,
  Perm,
  PriceSource,
  Quote,
  QuoteLine,
  Role,
  Tier,
} from "@/lib/api/types";
import bannersFx from "@/mocks/fixtures/banners.json";
import campaignFx from "@/mocks/fixtures/campaign-active.json";
import categoriesFx from "@/mocks/fixtures/categories.json";
import flashFx from "@/mocks/fixtures/flash-sale-current.json";
import meAdminFx from "@/mocks/fixtures/me-admin.json";
import orderDetailFx from "@/mocks/fixtures/order-detail.json";
import productDetailFx from "@/mocks/fixtures/product-detail.json";
import productListFx from "@/mocks/fixtures/product-list.json";
import promotionsFx from "@/mocks/fixtures/admin-promotion-list.json";
import reviewsFx from "@/mocks/fixtures/product-reviews.json";
import { bkkDay, canTransition, type OrderStatusKey } from "./format.ts";

// ---------- helpers ----------
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
let seed = 20261117;
function rnd() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const roundHalfUp = (n: number, d: number) => Math.floor((n * 2 + d) / (2 * d)); // round(n/d) half-up, ints

function err(status: number, code: ApiError["code"], message: string, fields?: Record<string, string>, details?: unknown): never {
  throw new ApiError(status, { code, message, fields, details });
}
function paginate<T>(rows: T[], q?: Query, def = 24) {
  const per = Math.min(100, Math.max(1, Number(q?.per_page ?? def) || def));
  const total = rows.length;
  const total_pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(total_pages, Math.max(1, Number(q?.page ?? 1) || 1));
  return { data: rows.slice((page - 1) * per, page * per), meta: { page, per_page: per, total, total_pages } };
}
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const has = (q: Query | undefined, k: string) => q !== undefined && q[k] !== undefined && q[k] !== null && q[k] !== "";
const matchesQ = (q: Query | undefined, ...fields: (string | null | undefined)[]) => {
  if (!has(q, "q")) return true;
  const needle = str(q!.q).toLowerCase();
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
};
let nextId = 5000;
const newId = () => ++nextId;

// ---------- session ----------
const ROLE_PERMS: Record<Role, Perm[]> = {
  customer: [],
  staff: ["dashboard:read", "catalog:read", "inventory:write", "orders:read", "orders:fulfil", "promotions:read"],
  admin: [
    "dashboard:read",
    "catalog:read",
    "inventory:write",
    "orders:read",
    "orders:fulfil",
    "promotions:read",
    "catalog:write",
    "orders:manage",
    "promotions:write",
    "customers:read",
    "customers:write",
    "banners:write",
    "reviews:moderate",
    "audit:read",
  ],
  owner: meAdminFx.data.perms as Perm[],
};
function roleForEmail(email: string): Role {
  const e = email.toLowerCase();
  if (e.includes("customer")) return "customer";
  if (e.includes("staff")) return "staff";
  if (e.startsWith("admin")) return "admin";
  return "owner";
}
export function mockSessionMe(email: string): Me {
  const role = roleForEmail(email);
  const base = meAdminFx.data as Me;
  return {
    ...base,
    email,
    role,
    name: role === "owner" ? base.name : role === "admin" ? "แอดมินร้าน" : role === "staff" ? "พนักงานแพ็คของ" : "ลูกค้า",
    perms: ROLE_PERMS[role],
  };
}
function currentMe(): Me | null {
  try {
    const e = sessionStorage.getItem("shopship_admin_mock_session");
    return e ? mockSessionMe(e) : null;
  } catch {
    return null;
  }
}
function requirePerm(p: Perm) {
  const me = currentMe();
  if (!me) err(401, "unauthorized", "กรุณาเข้าสู่ระบบ");
  if (me.role === "customer") err(403, "forbidden", "บัญชีนี้ไม่มีสิทธิ์เข้าหลังร้าน");
  if (!me.perms.includes(p)) err(403, "forbidden", "คุณไม่มีสิทธิ์ทำรายการนี้");
  return me;
}

// ---------- seed: categories ----------
type CatFx = { id: number; slug: string; name: string; description: string; image_url: string; icon: string; parent_id: number | null; sort_order: number; product_count: number; children: CatFx[] };
const categories: AdminCategory[] = [];
for (const c of categoriesFx.data as CatFx[]) {
  for (const x of [c, ...c.children]) {
    categories.push({
      id: x.id,
      slug: x.slug,
      name: x.name,
      parent_id: x.parent_id,
      description: x.description,
      image_url: x.image_url,
      icon: x.icon,
      sort_order: x.sort_order,
      is_active: true,
      seo_title: "",
      seo_description: "",
    });
  }
}
const catRef = (id: number) => {
  const c = categories.find((x) => x.id === id)!;
  return { id: c.id, slug: c.slug, name: c.name };
};

// ---------- seed: products ----------
const products: AdminProduct[] = [];
const priceHistory = new Map<number, { price_satang: number; changed_at: string }[]>();
type Card = (typeof productListFx.data)[number];
const fixtureCat: Record<number, number> = { 11: 12, 12: 11, 13: 21, 14: 22, 15: 13, 16: 31 };
const fixtureOptions: Record<number, { name: string; values: string[] }[]> = {
  11: [{ name: "สี", values: ["สีธรรมชาติ", "ดำ"] }],
  13: [{ name: "สี", values: ["ขาว", "ดำ"] }],
  14: [{ name: "สี", values: ["ดำ", "เงิน"] }],
  15: [
    { name: "สี", values: ["ดำ", "ขาว"] },
    { name: "ไซซ์", values: ["ฟรีไซซ์"] },
  ],
  16: [{ name: "สี", values: ["ขาว"] }],
};
const skuBase: Record<number, string> = { 11: "TOTE", 13: "EAR-PRO", 14: "SW-LITE", 15: "SOCK", 16: "MUG" };
const colorCode: Record<string, string> = { สีธรรมชาติ: "NAT", ดำ: "BLK", ขาว: "WHT", เงิน: "SLV", กรมท่า: "NVY", เทา: "GRY", ครีม: "CRM" };

function mkVariant(id: number, sku: string, option_values: Record<string, string>, price: number, stock: number, img: number | null): AdminVariant {
  return {
    id,
    sku,
    name: Object.values(option_values).join(" / "),
    option_values,
    price_satang: price,
    cost_satang: Math.round(price * 0.55),
    stock,
    weight_grams: 250,
    barcode: "",
    low_stock_threshold: 5,
    is_active: true,
    image_id: img,
  };
}
function baseProduct(card: Card, catId: number, options: { name: string; values: string[] }[], variants: AdminVariant[], images: Image[], status: AdminProduct["status"] = "active"): AdminProduct {
  return {
    ...(card as unknown as AdminProduct),
    name_en: card.name_en ?? "",
    description: `${card.name} — ${card.subtitle}`,
    category: catRef(catId),
    breadcrumbs: [],
    options,
    variants,
    images,
    reviews_summary: { rating_avg: card.rating_avg, rating_count: card.rating_count, histogram: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }, with_images_count: 0 },
    tags: [],
    seo: { title: "", description: "" },
    status,
    featured: false,
    created_at: "2026-10-01T03:00:00Z",
    updated_at: "2026-11-15T03:00:00Z",
  };
}
const stockFor = (vid: number) => (vid === 207 ? 0 : vid === 206 ? 3 : vid === 401 ? 4 : vid === 601 ? 0 : 20 + (vid % 7) * 9);
for (const card of productListFx.data) {
  if (card.id === 12) {
    const d = productDetailFx.data;
    products.push({
      ...(d as unknown as AdminProduct),
      name_en: d.name_en ?? "",
      status: "active",
      featured: true,
      variants: d.variants.map((v) => ({ ...mkVariant(v.id, v.sku, v.option_values, v.price_satang, stockFor(v.id), v.image_id), name: v.name })),
      created_at: "2026-10-01T03:00:00Z",
      updated_at: "2026-11-15T03:00:00Z",
    });
    continue;
  }
  const opts = fixtureOptions[card.id];
  const combos = opts.length === 1 ? opts[0].values.map((v) => ({ [opts[0].name]: v })) : opts[0].values.map((v) => ({ [opts[0].name]: v, [opts[1].name]: opts[1].values[0] }));
  const variants = combos.map((ov, i) => {
    const vid = card.id === 15 ? 501 + i : (card.id - 10) * 100 + 1 + i;
    const color = Object.values(ov)[0];
    const sku = card.id === 15 ? `SOCK-${colorCode[color]}-F` : `${skuBase[card.id]}-${colorCode[color] ?? "STD"}`;
    return mkVariant(vid, sku, ov, card.min_price_satang, stockFor(vid), card.image?.id ?? null);
  });
  products.push(baseProduct(card, fixtureCat[card.id], opts, variants, card.image ? [card.image] : [], card.id === 16 ? "hidden" : "active"));
}
// generated extra catalogue (for pagination / search)
const extra: [string, string, number, number, string][] = [
  ["เสื้อยืดคอตตอนสีขาว", "Cotton Tee White", 11, 29000, "linen-shirt-white"],
  ["เสื้อโปโลผ้าปิเก้", "Pique Polo", 11, 45000, "linen-shirt-navy"],
  ["กางเกงขาสั้นลินิน", "Linen Shorts", 11, 49000, "linen-shirt-white"],
  ["กระเป๋าสะพายข้าง", "Crossbody Bag", 12, 79000, "canvas-tote"],
  ["กระเป๋าเป้แคนวาส", "Canvas Backpack", 12, 129000, "canvas-tote"],
  ["ถุงเท้าข้อสั้น 3 คู่", "Ankle Socks 3-pack", 13, 19000, "cotton-socks"],
  ["ถุงเท้ากีฬา", "Sport Socks", 13, 14900, "cotton-socks"],
  ["ลำโพงบลูทูธ Mini", "Bluetooth Speaker Mini", 21, 99000, "earbuds-pro"],
  ["หูฟังครอบหู", "Over-ear Headphones", 21, 249000, "earbuds-pro"],
  ["สายนาฬิกาซิลิโคน", "Silicone Watch Strap", 22, 19000, "smart-watch-lite"],
  ["แก้วกาแฟสองชั้น", "Double-wall Cup", 31, 39000, "ceramic-mug"],
  ["จานเซรามิก 8 นิ้ว", "Ceramic Plate 8in", 31, 25000, "ceramic-mug"],
  ["ชุดช้อนส้อมไม้", "Wooden Cutlery Set", 31, 15900, "ceramic-mug"],
  ["ผ้ากันเปื้อนลินิน", "Linen Apron", 31, 35000, "linen-shirt-navy"],
  ["หมอนอิงผ้าฝ้าย", "Cotton Cushion", 31, 42000, "canvas-tote"],
  ["แก้วน้ำพกพา", "Travel Tumbler", 31, 55000, "ceramic-mug"],
  ["สมุดโน้ตปกผ้า", "Cloth Notebook", 12, 18000, "canvas-tote"],
  ["หมวกบักเก็ต", "Bucket Hat", 11, 39000, "linen-shirt-white"],
];
extra.forEach(([name, en, cat, price, key], i) => {
  const id = 100 + i;
  const img: Image = { id: id * 10 + 1, url: `/mock/${key}.svg`, alt: name, width: 800, height: 800 };
  const colors = i % 3 === 0 ? ["ขาว", "ดำ", "เทา"] : ["ครีม", "ดำ"];
  const sizes = cat === 11 ? ["S", "M", "L"] : [];
  const opts = sizes.length ? [{ name: "ไซซ์", values: sizes }, { name: "สี", values: colors }] : [{ name: "สี", values: colors }];
  const variants: AdminVariant[] = [];
  let n = 0;
  for (const s of sizes.length ? sizes : [""]) {
    for (const c of colors) {
      const vid = id * 100 + ++n;
      const ov: Record<string, string> = s ? { ไซซ์: s, สี: c } : { สี: c };
      variants.push(mkVariant(vid, `P${id}-${s ? s + "-" : ""}${colorCode[c] ?? "X"}`, ov, price, Math.floor(rnd() * 60) + (i === 4 ? 0 : 1), img.id));
    }
  }
  const card = {
    id,
    slug: `product-${id}`,
    name,
    name_en: en,
    subtitle: "",
    brand: "ShopShip Basics",
    image: img,
    min_price_satang: price,
    max_price_satang: price,
    flash: null,
    rating_avg: 4 + rnd(),
    rating_count: Math.floor(rnd() * 80),
    sold_count: Math.floor(rnd() * 900),
    in_stock: true,
    badges: [],
  } as unknown as Card;
  products.push(baseProduct(card, cat, opts, variants, [img], i % 7 === 6 ? "draft" : "active"));
});
for (const p of products)
  for (const v of p.variants)
    priceHistory.set(v.id, [
      { price_satang: v.price_satang + 2000, changed_at: "2026-09-01T03:00:00Z" },
      { price_satang: v.price_satang, changed_at: "2026-10-01T03:00:00Z" },
    ]);

const findVariant = (vid: number) => {
  for (const p of products) {
    const v = p.variants.find((x) => x.id === vid);
    if (v) return { p, v };
  }
  return null;
};
function refreshProduct(p: AdminProduct) {
  const act = p.variants.filter((v) => v.is_active);
  const prices = act.length ? act.map((v) => v.price_satang) : [0];
  p.min_price_satang = Math.min(...prices);
  p.max_price_satang = Math.max(...prices);
  p.in_stock = act.some((v) => v.stock > 0);
  p.image = p.images[0] ?? null;
  p.updated_at = iso(Date.now());
}
products.forEach(refreshProduct);
const productRow = (p: AdminProduct): AdminProductRow => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  name_en: p.name_en,
  status: p.status,
  category: p.category,
  image_url: p.images[0]?.url ?? "",
  min_price_satang: p.min_price_satang,
  max_price_satang: p.max_price_satang,
  total_stock: p.variants.filter((v) => v.is_active).reduce((s, v) => s + v.stock, 0),
  variant_count: p.variants.filter((v) => v.is_active).length,
  updated_at: p.updated_at,
});

// ---------- seed: groups, users ----------
const groups: CustomerGroup[] = [
  { id: 1, code: "vip", name: "ลูกค้า VIP", description: "ลูกค้าประจำยอดซื้อสูง", member_count: 0 },
  { id: 2, code: "wholesale", name: "ลูกค้าขายส่ง", description: "ร้านค้าที่ซื้อไปขายต่อ ได้ราคาขายส่ง", member_count: 0 },
  { id: 3, code: "corporate", name: "องค์กร", description: "สั่งซื้อในนามบริษัท ออกใบกำกับภาษี", member_count: 0 },
];
const firstNames = ["สมชาย", "สมหญิง", "วิภา", "ธนา", "กมล", "อรุณ", "ปิยะ", "ศิริ", "นภา", "ชัย", "มาลี", "ประยุทธ", "สุดา", "อนันต์", "รัตนา", "วีระ", "จันทร์", "พร", "ณัฐ", "ภูมิ"];
const lastNames = ["ใจดี", "รักไทย", "ศรีสุข", "มั่นคง", "แสงทอง", "บุญมา", "ทองดี", "สายสุวรรณ"];
const users: (AdminUser & { group_id: number | null })[] = [
  { id: 1, email: "owner@shopship.local", name: "เจ้าของร้าน", phone: "", role: "owner", tier: "standard", group: null, group_id: null, is_active: true, order_count: 0, total_spent_satang: 0, created_at: "2026-11-01T00:00:00Z", last_login_at: iso(Date.now() - 3600_000) },
  { id: 2, email: "admin@shopship.local", name: "แอดมินร้าน", phone: "0899999999", role: "admin", tier: "standard", group: null, group_id: null, is_active: true, order_count: 0, total_spent_satang: 0, created_at: "2026-11-02T00:00:00Z", last_login_at: iso(Date.now() - 86400_000) },
  { id: 3, email: "staff@shopship.local", name: "พนักงานแพ็คของ", phone: "0888888888", role: "staff", tier: "standard", group: null, group_id: null, is_active: true, order_count: 0, total_spent_satang: 0, created_at: "2026-11-03T00:00:00Z", last_login_at: iso(Date.now() - 7200_000) },
];
const tiers: Tier[] = ["standard", "standard", "standard", "silver", "silver", "gold", "platinum"];
for (let i = 0; i < 26; i++) {
  const name = i === 0 ? "สมชาย ใจดี" : `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`;
  const gid = i === 0 || i % 9 === 4 ? 2 : i % 11 === 3 ? 1 : i % 13 === 7 ? 3 : null;
  users.push({
    id: 10 + i,
    email: i === 0 ? "somchai@example.com" : `customer${i}@example.com`,
    name,
    phone: `08${String(10000000 + i * 734521).slice(0, 8)}`,
    role: "customer",
    tier: i === 0 ? "gold" : tiers[i % tiers.length],
    group: null,
    group_id: gid,
    is_active: i !== 17,
    order_count: 0,
    total_spent_satang: 0,
    created_at: iso(Date.now() - (60 - i) * DAY),
    last_login_at: iso(Date.now() - i * 3 * 3600_000),
  });
}
function syncUser(u: (typeof users)[number]) {
  const g = groups.find((x) => x.id === u.group_id);
  u.group = g ? { id: g.id, code: g.code, name: g.name } : null;
}
users.forEach(syncUser);
const groupCounts = () => groups.forEach((g) => (g.member_count = users.filter((u) => u.group_id === g.id).length));

// ---------- seed: orders ----------
type MockOrder = AdminOrder & { customer_id: number };
const orders: MockOrder[] = [];
const fxOrder = orderDetailFx.data as unknown as AdminOrder;
const statuses: OrderStatus[] = ["paid", "paid", "packing", "paid", "shipped", "delivered", "completed", "completed", "pending_payment", "cancelled", "completed", "shipped", "refunded"];
function mkOrder(i: number, t: number, status: OrderStatus, cust: (typeof users)[number]): MockOrder {
  const nLines = 1 + Math.floor(rnd() * 3);
  const items = [];
  const used = new Set<number>();
  for (let k = 0; k < nLines; k++) {
    const p = pick(products.filter((x) => x.status === "active"));
    const v = pick(p.variants);
    if (used.has(v.id)) continue;
    used.add(v.id);
    const qty = 1 + Math.floor(rnd() * 3);
    items.push({
      variant_id: v.id,
      product_slug: p.slug,
      sku: v.sku,
      product_name: p.name,
      variant_name: v.name,
      image_url: p.images[0]?.url ?? "",
      qty,
      list_unit_price_satang: v.price_satang,
      unit_price_satang: v.price_satang,
      price_source: { kind: "list" as const, label: "" },
      line_discount_satang: 0,
      line_total_satang: v.price_satang * qty,
      allocated_discount_satang: 0,
      lowest_30d_satang: null,
    });
  }
  const sub = items.reduce((s, x) => s + x.line_total_satang, 0);
  const free = sub >= 99900;
  const d = new Date(t);
  const order_no = `SS${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${(i * 7919).toString(36).toUpperCase().padStart(4, "X").slice(-4)}`;
  const flow: OrderStatus[] = ["pending_payment", "paid", "packing", "shipped", "delivered", "completed"];
  const timeline: AdminOrder["timeline"] = [];
  const history: AdminOrder["status_history"] = [];
  let prev: OrderStatus | null = null;
  const pushStep = (s: OrderStatus, at: number, note = "") => {
    timeline.push({ status: s, at: iso(at), note });
    history.push({ from_status: prev, to_status: s, actor_email: s === "paid" || s === "pending_payment" ? null : "staff@shopship.local", note, created_at: iso(at) });
    prev = s;
  };
  if (status === "cancelled") {
    pushStep("pending_payment", t);
    pushStep("cancelled", t + 15 * 60_000, "หมดเวลาชำระเงิน");
  } else if (status === "refunded") {
    flow.forEach((s, k) => pushStep(s, t + k * 3 * 3600_000, s === "paid" ? "PromptPay" : ""));
    pushStep("refunded", t + 20 * 3600_000, "ลูกค้าขอคืนสินค้า");
  } else {
    const upto = flow.indexOf(status);
    for (let k = 0; k <= upto; k++) pushStep(flow[k], t + k * 3 * 3600_000, flow[k] === "paid" ? "PromptPay" : "");
  }
  const paid = timeline.find((x) => x.status === "paid");
  const shipped = ["shipped", "delivered", "completed", "refunded"].includes(status);
  const method = rnd() > 0.35 ? "promptpay" : "card";
  const grand = sub + (free ? 0 : 4000);
  return {
    ...fxOrder,
    order_no,
    status,
    items,
    adjustments: [],
    totals: {
      list_subtotal_satang: sub,
      subtotal_satang: sub,
      discount_satang: 0,
      shipping_fee_satang: 4000,
      shipping_discount_satang: free ? 4000 : 0,
      savings_satang: free ? 4000 : 0,
      grand_total_satang: grand,
    },
    coupon_code: null,
    payment_method: method,
    shipping_address: { ...fxOrder.shipping_address, recipient_name: cust.name, phone: cust.phone },
    email: cust.email,
    payment: paid ? { status: status === "refunded" ? "refunded" : "successful", method, charge_id: `chrg_mock_${order_no.toLowerCase()}`, expires_at: iso(t + 15 * 60_000) } : status === "pending_payment" ? { status: "pending", method, charge_id: `chrg_mock_${order_no.toLowerCase()}`, expires_at: iso(t + 15 * 60_000) } : null,
    shipment: shipped ? { id: 7000 + i, carrier: "flash_mock", tracking_no: `TH${String(1000000000 + i * 37781).slice(0, 10)}MK`, status: status === "shipped" ? "in_transit" : "delivered", label_url: "" } : null,
    timeline,
    payment_due_at: iso(t + 15 * 60_000),
    paid_at: paid?.at ?? null,
    cancelled_at: status === "cancelled" ? iso(t + 15 * 60_000) : null,
    created_at: iso(t),
    customer: { id: cust.id, email: cust.email, name: cust.name },
    payments: paid ? [{ charge_id: `chrg_mock_${order_no.toLowerCase()}`, method, status: "successful", amount_satang: grand, created_at: iso(t) }] : [],
    status_history: history,
    customer_id: cust.id,
  };
}
{
  const now = Date.now();
  const customers = users.filter((u) => u.role === "customer");
  for (let i = 0; i < 54; i++) {
    const age = i < 6 ? i * 40 * 60_000 + 20 * 60_000 : (i - 5) * 0.55 * DAY + rnd() * 6 * 3600_000;
    const st: OrderStatus = i < 3 ? (["paid", "paid", "pending_payment"] as OrderStatus[])[i] : i < 6 ? (["packing", "paid", "paid"] as OrderStatus[])[i - 3] : age > 4 * DAY && statuses[i % statuses.length] !== "cancelled" ? pick(["completed", "completed", "delivered", "refunded"] as OrderStatus[]) : statuses[i % statuses.length];
    orders.push(mkOrder(i + 1, now - age, st, i === 1 ? customers[0] : pick(customers)));
  }
  // the golden fixture order stays addressable by its number
  orders.unshift({
    ...fxOrder,
    customer: { id: 10, email: fxOrder.email, name: "สมชาย ใจดี" },
    payments: [{ charge_id: fxOrder.payment!.charge_id, method: "promptpay", status: "successful", amount_satang: fxOrder.totals.grand_total_satang, created_at: fxOrder.created_at }],
    status_history: fxOrder.timeline.map((x, k) => ({ from_status: k ? fxOrder.timeline[k - 1].status : null, to_status: x.status, actor_email: null, note: x.note, created_at: x.at })),
    customer_id: 10,
  });
  orders.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const u of users) {
    const mine = orders.filter((o) => o.customer_id === u.id && !["cancelled", "pending_payment"].includes(o.status));
    u.order_count = orders.filter((o) => o.customer_id === u.id).length;
    u.total_spent_satang = mine.reduce((s, o) => s + o.totals.grand_total_satang, 0);
  }
}
const shipments = new Map<number, { order_no: string; tracking_no: string; fee: number }>();
const orderRow = (o: MockOrder): AdminOrderRow => ({
  order_no: o.order_no,
  status: o.status,
  customer: o.customer,
  item_count: o.items.reduce((s, x) => s + x.qty, 0),
  grand_total_satang: o.totals.grand_total_satang,
  payment_method: o.payment_method,
  created_at: o.created_at,
  paid_at: o.paid_at,
});

// ---------- seed: promotions / campaigns / flash ----------
const promotions: AdminPromotion[] = (promotionsFx.data as AdminPromotion[]).map((p) => ({ ...p }));
const campaigns: AdminCampaign[] = [
  { ...(campaignFx.data as unknown as AdminCampaign), priority: 10, is_active: true },
  { id: 4, slug: "12-12-2026", name: "12.12 ส่งท้ายปี", season_tag: "12-12", theme: { accent: "#D70015", accent_contrast: "#FFFFFF", background: "#FFFFFF", hero_image_url: "/mock/hero-1111.svg", badge_text: "12.12" }, starts_at: "2026-12-11T17:00:00Z", ends_at: "2026-12-12T17:00:00Z", priority: 10, is_active: true },
  { id: 5, slug: "new-year-2027", name: "ปีใหม่ 2027", season_tag: "new-year", theme: { accent: "#9A5B00", accent_contrast: "#FFFFFF", background: "#FFFBF2", hero_image_url: "/mock/hero-songkran.svg", badge_text: "ปีใหม่" }, starts_at: "2026-12-26T17:00:00Z", ends_at: "2027-01-03T17:00:00Z", priority: 5, is_active: true },
  { id: 2, slug: "songkran-2026", name: "สงกรานต์ 2026", season_tag: "songkran", theme: { accent: "#0066CC", accent_contrast: "#FFFFFF", background: "#F2F8FF", hero_image_url: "/mock/hero-songkran.svg", badge_text: "สงกรานต์" }, starts_at: "2026-04-09T17:00:00Z", ends_at: "2026-04-16T17:00:00Z", priority: 5, is_active: true },
  { id: 1, slug: "6-6-2026", name: "6.6 Mid-Year", season_tag: "6-6", theme: { accent: "#1D7A3A", accent_contrast: "#FFFFFF", background: "#FFFFFF", hero_image_url: "/mock/hero-1111.svg", badge_text: "6.6" }, starts_at: "2026-06-05T17:00:00Z", ends_at: "2026-06-07T17:00:00Z", priority: 5, is_active: true },
];
const campRef = (id: number | null | undefined) => {
  const c = campaigns.find((x) => x.id === id);
  return c ? { id: c.id, slug: c.slug, name: c.name } : null;
};
const promoTemplate = promotions[0];
function addPromo(p: Partial<AdminPromotion> & Pick<AdminPromotion, "id" | "name" | "label" | "kind" | "layer">) {
  promotions.push({ ...promoTemplate, qty_tiers: [], targets: [], codes: [], customer_group_ids: [], tiers: [], percent_bp: null, amount_satang: null, priority: 0, ...p });
}
addPromo({ id: 16, name: "Silver ลด 3%", label: "สมาชิก Silver ลด 3%", kind: "tier_price", layer: 1, percent_bp: 300, tiers: ["silver"] });
addPromo({ id: 18, name: "Platinum ลด 12%", label: "สมาชิก Platinum ลด 12%", kind: "tier_price", layer: 1, percent_bp: 1200, tiers: ["platinum"], priority: 2 });
addPromo({ id: 19, name: "ราคาส่งถุงเท้า", label: "ราคาส่งถุงเท้า 5 คู่ขึ้นไป", kind: "quantity_break", layer: 1, customer_group_ids: [2], targets: [{ type: "category", id: 13, name: "ถุงเท้า" }], qty_tiers: [{ min_qty: 5, unit_price_satang: null, percent_bp: 500 }, { min_qty: 10, unit_price_satang: null, percent_bp: 1000 }, { min_qty: 50, unit_price_satang: null, percent_bp: 1500 }] });
addPromo({ id: 22, name: "ครบ 2,000 ลด 10%", label: "ช้อปครบ ฿2,000 ลด 10% สูงสุด ฿300", kind: "cart_percent", layer: 3, percent_bp: 1000, min_spend_satang: 200000, max_discount_satang: 30000, status: "draft", state: "draft" });
addPromo({ id: 44, name: "ต้อนรับสมาชิกใหม่", label: "โค้ด WELCOME50 ลด ฿50", kind: "cart_amount", layer: 4, auto_apply: false, amount_satang: 5000, min_spend_satang: 30000, per_customer_limit: 1, usage_limit: null, used_count: 128, codes: [{ id: 404, code: "WELCOME50", is_active: true }] });
addPromo({ id: 45, name: "โค้ด 12.12", label: "โค้ด 1212 ลด 12% สูงสุด ฿300", kind: "cart_percent", layer: 4, auto_apply: false, percent_bp: 1200, max_discount_satang: 30000, usage_limit: 1212, per_customer_limit: 1, starts_at: "2026-12-11T17:00:00Z", ends_at: "2026-12-12T17:00:00Z", codes: [{ id: 405, code: "1212", is_active: true }], campaign: campRef(4), season_tag: "12-12", state: "scheduled", exclusive: true });
addPromo({ id: 46, name: "โค้ดส่งฟรี", label: "โค้ด FREESHIP ส่งฟรี", kind: "free_shipping", layer: 4, auto_apply: false, min_spend_satang: 50000, max_discount_satang: 4000, usage_limit: 500, used_count: 77, codes: [{ id: 406, code: "FREESHIP", is_active: true }] });
addPromo({ id: 47, name: "โค้ดปีใหม่", label: "โค้ด NY2027 ลด ฿200", kind: "cart_amount", layer: 4, auto_apply: false, amount_satang: 20000, min_spend_satang: 150000, starts_at: "2026-12-26T17:00:00Z", ends_at: "2027-01-03T17:00:00Z", codes: [{ id: 407, code: "NY2027", is_active: true }], campaign: campRef(5), season_tag: "new-year", state: "scheduled", tiers: ["gold", "platinum"] });
const songkran = promotions.find((p) => p.id === 43);
if (songkran) songkran.campaign = campRef(2);
let nextCodeId = 900;

function promoState(p: AdminPromotion, now = Date.now()): AdminPromotion["state"] {
  if (p.status === "draft" || p.status === "paused" || p.status === "archived") return p.status;
  if (Date.parse(p.starts_at) > now) return "scheduled";
  if (p.ends_at && Date.parse(p.ends_at) <= now) return "ended";
  return "running";
}

const fxFlash = flashFx.data.current!;
const nowT = Date.now();
const flashSales: AdminFlashSale[] = [
  {
    id: 7,
    name: "Flash Sale 11.11",
    label: fxFlash.label,
    status: "active",
    starts_at: iso(nowT - 3 * 3600_000),
    ends_at: iso(nowT + 9 * 3600_000),
    campaign_id: 3,
    items: [
      { id: 71, variant_id: 401, sku: "SW-LITE-BLK", product_name: "สมาร์ทวอทช์ Lite", variant_name: "ดำ", list_price_satang: 89000, sale_price_satang: 59000, qty_limit: 100, sold_qty: 62, per_customer_limit: 1, sort_order: 1 },
      { id: 72, variant_id: 301, sku: "EAR-PRO-WHT", product_name: "หูฟังไร้สาย Pro", variant_name: "ขาว", list_price_satang: 120000, sale_price_satang: 89000, qty_limit: 50, sold_qty: 41, per_customer_limit: 2, sort_order: 2 },
      { id: 73, variant_id: 101, sku: "TOTE-NAT", product_name: "ถุงผ้าแคนวาส", variant_name: "สีธรรมชาติ", list_price_satang: 25000, sale_price_satang: 15900, qty_limit: 200, sold_qty: 37, per_customer_limit: null, sort_order: 3 },
    ],
  },
  { id: 8, name: "Flash Sale 12.12", label: "Flash Sale 12.12", status: "active", starts_at: "2026-12-12T03:00:00Z", ends_at: "2026-12-12T15:00:00Z", campaign_id: 4, items: [{ id: 81, variant_id: 302, sku: "EAR-PRO-BLK", product_name: "หูฟังไร้สาย Pro", variant_name: "ดำ", list_price_satang: 120000, sale_price_satang: 79000, qty_limit: 80, sold_qty: 0, per_customer_limit: 1, sort_order: 1 }] },
  { id: 6, name: "Flash Sale 10.10", label: "Flash Sale 10.10", status: "active", starts_at: "2026-10-10T03:00:00Z", ends_at: "2026-10-10T15:00:00Z", campaign_id: null, items: [{ id: 61, variant_id: 205, sku: "LIN-WHT-M", product_name: "เสื้อเชิ้ตลินิน", variant_name: "ขาว / M", list_price_satang: 59000, sale_price_satang: 39000, qty_limit: 60, sold_qty: 60, per_customer_limit: 2, sort_order: 1 }] },
];

// ---------- seed: banners, reviews, audit ----------
const banners: AdminBanner[] = (bannersFx.data as AdminBanner[]).map((b, i) => ({
  ...b,
  starts_at: b.campaign_id ? campaigns[0].starts_at : null,
  ends_at: b.campaign_id ? campaigns[0].ends_at : null,
  is_active: true,
  sort_order: i + 1,
  category_id: null,
}));
banners.push(
  { id: 3, placement: "home_strip", title: "ส่งฟรีเมื่อช้อปครบ ฿999", subtitle: "ทุกออเดอร์ ทั่วประเทศ", cta_label: "", link_url: "/search", image_url: "", image_mobile_url: "", image_alt: "", campaign_id: null, starts_at: null, ends_at: null, is_active: true, sort_order: 1, category_id: null },
  { id: 4, placement: "home_hero", title: "12.12 ส่งท้ายปี", subtitle: "โค้ด 1212 ลด 12%", cta_label: "ดูโปร", link_url: "/flash-sale", image_url: "/mock/hero-1111.svg", image_mobile_url: "", image_alt: "แคมเปญ 12.12", campaign_id: 4, starts_at: "2026-12-11T17:00:00Z", ends_at: "2026-12-12T17:00:00Z", is_active: true, sort_order: 3, category_id: null },
);
const reviews: AdminReview[] = [
  ...(reviewsFx.data as AdminReview[]).map((r) => ({ ...r, status: "published" as const, product: { id: 12, slug: "linen-shirt", name: "เสื้อเชิ้ตลินิน" } })),
];
const reviewBodies: [number, string][] = [
  [5, "ส่งไวมาก แพ็คดี"],
  [2, "สีไม่ตรงปก ผิดหวังนิดหน่อย"],
  [4, "คุ้มราคา ใช้ดี"],
  [1, "ของมาไม่ครบ ติดต่อร้านแล้วยังไม่ตอบ"],
  [5, "ซื้อซ้ำครั้งที่สามแล้วค่ะ"],
  [3, "ก็โอเค แต่ไซซ์เล็กไปหน่อย"],
  [5, "เสียงดีเกินราคา"],
  [1, "สแปม ลิงก์โปรโมทร้านอื่น"],
];
reviewBodies.forEach(([rating, body], i) => {
  const p = products[(i + 1) % 6];
  reviews.push({ id: 910 + i, rating, title: "", body, author_name: `${firstNames[i][0]}***${firstNames[i].slice(-1)}`, variant_name: p.variants[0].name, images: [], created_at: iso(Date.now() - i * 1.3 * DAY), reply: null, status: i === 7 ? "hidden" : "published", product: { id: p.id, slug: p.slug, name: p.name } });
});
const audit: AuditLog[] = [];
function log(action: string, target_type: string, target_id: string | number, metadata: unknown = {}) {
  const me = currentMe();
  audit.unshift({ id: newId(), actor: me ? { id: me.id, email: me.email } : null, action, target_type, target_id: String(target_id), metadata, ip: "127.0.0.1", created_at: iso(Date.now()) });
}
(
  [
    ["product.update", "product", 12, { fields: ["price_satang"] }, "owner@shopship.local", 1],
    ["promotion.create", "promotion", 42, { name: "โค้ด 11.11 exclusive" }, "owner@shopship.local", 2],
    ["order.status", "order", fxOrder.order_no, { from: "pending_payment", to: "paid" }, null, 3],
    ["inventory.adjust", "variant", 206, { delta: -2, reason: "สินค้าชำรุด" }, "staff@shopship.local", 5],
    ["user.update", "user", 10, { group_id: 2 }, "admin@shopship.local", 8],
    ["banner.update", "banner", 1, { is_active: true }, "admin@shopship.local", 12],
    ["campaign.create", "campaign", 4, { name: "12.12 ส่งท้ายปี" }, "owner@shopship.local", 20],
    ["auth.login", "user", 3, {}, "staff@shopship.local", 26],
    ["flash_sale.items", "flash_sale", 7, { items: 3 }, "owner@shopship.local", 30],
    ["review.hide", "review", 917, {}, "admin@shopship.local", 40],
  ] as [string, string, string | number, unknown, string | null, number][]
).forEach(([action, target_type, target_id, metadata, email, hAgo], i) =>
  audit.push({ id: 100 + i, actor: email ? { id: users.find((u) => u.email === email)!.id, email } : null, action, target_type, target_id: String(target_id), metadata, ip: email ? "171.96.12.34" : "", created_at: iso(Date.now() - hAgo * 3600_000) }),
);

// ---------- pricing (simplified engine for the preview simulator; the real one is api/internal/pricing) ----------
function targetsMatch(p: AdminPromotion, prod: AdminProduct, vid: number) {
  if (p.targets.length === 0) return true;
  const parent = categories.find((c) => c.id === prod.category.id)?.parent_id;
  return p.targets.some((t) => (t.type === "variant" && t.id === vid) || (t.type === "product" && t.id === prod.id) || (t.type === "category" && (t.id === prod.category.id || t.id === parent)));
}
function audienceOk(p: AdminPromotion, u: (typeof users)[number] | null) {
  if (p.customer_group_ids.length && !(u && u.group_id && p.customer_group_ids.includes(u.group_id))) return false;
  if (p.tiers.length && !(u && p.tiers.includes(u.tier))) return false;
  return true;
}
const pctOf = (amount: number, bp: number) => roundHalfUp(amount * bp, 10000);

export function mockPrice(req: PreviewRequest): Quote {
  const now = req.now ? Date.parse(req.now) : Date.now();
  const user = req.user_id ? users.find((u) => u.id === req.user_id) ?? null : null;
  const live = promotions.filter((p) => p.status === "active" && Date.parse(p.starts_at) <= now && (!p.ends_at || Date.parse(p.ends_at) > now));
  const gated = (p: AdminPromotion) => ["quantity_break", "group_price", "tier_price"].includes(p.kind);
  const hints: Quote["hints"] = [];
  let memberSkipped = false;

  const lines: (QuoteLine & { prod: AdminProduct })[] = [];
  for (const l of req.lines) {
    const f = findVariant(l.variant_id);
    if (!f) continue;
    const { p: prod, v } = f;
    const list = v.price_satang;
    let best: { price: number; src: PriceSource } = { price: list, src: { kind: "list", label: "" } };
    const consider = (price: number, src: PriceSource) => {
      if (price < best.price) best = { price, src };
    };
    for (const fs of flashSales) {
      if (fs.status !== "active" || Date.parse(fs.starts_at) > now || Date.parse(fs.ends_at) <= now) continue;
      const it = fs.items.find((x) => x.variant_id === v.id);
      if (it && it.sold_qty + l.qty <= it.qty_limit && (it.per_customer_limit === null || l.qty <= it.per_customer_limit))
        consider(it.sale_price_satang, { kind: "flash_sale", label: fs.label, flash_sale_item_id: it.id });
    }
    for (const p of live.filter((x) => x.layer === 1 && targetsMatch(x, prod, v.id))) {
      if (gated(p) && !user) {
        memberSkipped = true;
        continue;
      }
      if (!audienceOk(p, user)) continue;
      if (p.kind === "quantity_break") {
        const tier = [...p.qty_tiers].sort((a, b) => b.min_qty - a.min_qty).find((t) => l.qty >= t.min_qty);
        if (tier) consider(tier.unit_price_satang ?? list - pctOf(list, tier.percent_bp ?? 0), { kind: "quantity_break", label: p.label, promotion_id: p.id });
      } else if (p.percent_bp) {
        consider(list - pctOf(list, p.percent_bp), { kind: p.kind as PriceSource["kind"], label: p.label, promotion_id: p.id });
      }
    }
    const adjs: Adjustment[] = [];
    if (best.src.kind !== "flash_sale") {
      let lineBest: Adjustment | null = null;
      for (const p of live.filter((x) => x.kind === "buy_x_get_y" && targetsMatch(x, prod, v.id) && audienceOk(x, user))) {
        const buy = p.buy_qty ?? 0;
        const get = p.get_qty ?? 0;
        if (buy + get <= 0) continue;
        const units = Math.floor(l.qty / (buy + get)) * get;
        const amt = pctOf(units * best.price, p.get_percent_bp ?? 10000);
        if (amt > 0 && (!lineBest || amt > lineBest.amount_satang)) lineBest = { promotion_id: p.id, layer: 2, label: p.label, amount_satang: amt };
        if (units === 0 && l.qty >= buy) hints.push({ kind: "buy_x_get_y_gap", message: `เพิ่มอีก ${buy + get - (l.qty % (buy + get))} ชิ้น รับ "${p.label}"`, promotion_id: p.id });
      }
      if (lineBest) adjs.push(lineBest);
    }
    const stock = v.stock;
    lines.push({
      prod,
      variant_id: v.id,
      qty: l.qty,
      list_unit_price_satang: list,
      unit_price_satang: best.price,
      price_source: best.src,
      adjustments: adjs,
      line_total_satang: l.qty * best.price - adjs.reduce((s, a) => s + a.amount_satang, 0),
      allocated_discount_satang: 0,
      lowest_30d_satang: best.src.kind === "list" ? null : Math.min(...(priceHistory.get(v.id) ?? [{ price_satang: list }]).map((x) => x.price_satang)),
      availability: !v.is_active ? { status: "unavailable", available_qty: 0 } : stock <= 0 ? { status: "out_of_stock", available_qty: 0 } : stock < l.qty ? { status: "insufficient_stock", available_qty: stock } : { status: "ok", available_qty: stock },
    });
  }
  const ok = lines.filter((l) => l.availability.status === "ok");
  const subtotal = ok.reduce((s, l) => s + l.line_total_satang, 0);
  const eligible = (p: AdminPromotion) => ok.filter((l) => targetsMatch(p, l.prod, l.variant_id)).reduce((s, l) => s + l.line_total_satang, 0);
  const cartAmount = (p: AdminPromotion, base: number) => {
    let a = p.kind === "cart_percent" ? pctOf(base, p.percent_bp ?? 0) : Math.min(p.amount_satang ?? 0, base);
    if (p.max_discount_satang !== null && p.kind === "cart_percent") a = Math.min(a, p.max_discount_satang);
    return a;
  };
  const byPrio = (a: AdminPromotion, b: AdminPromotion) => b.priority - a.priority || a.id - b.id;

  // layer 3
  let l3: { p: AdminPromotion; amount: number } | null = null;
  for (const p of live.filter((x) => x.layer === 3 && audienceOk(x, user)).sort(byPrio)) {
    const base = eligible(p);
    if (base <= 0) continue;
    if (base < p.min_spend_satang) {
      hints.push({ kind: "cart_promo_gap", message: `ซื้อเพิ่มอีก ฿${((p.min_spend_satang - base) / 100).toLocaleString("th-TH")} รับ "${p.label}"`, amount_satang: p.min_spend_satang - base, promotion_id: p.id });
      continue;
    }
    const a = cartAmount(p, base);
    if (!l3 || a > l3.amount) l3 = { p, amount: a };
  }

  // layer 4
  let coupon: Quote["coupon"] = null;
  let l4: { p: AdminPromotion; amount: number; code: string } | null = null;
  let shipCode: { p: AdminPromotion; code: string } | null = null;
  const code = (req.coupon_code ?? "").trim().toUpperCase();
  if (code) {
    const p = promotions.find((x) => x.layer === 4 && x.codes.some((c) => c.code.toUpperCase() === code));
    const c = p?.codes.find((x) => x.code.toUpperCase() === code);
    const bad = (reason_code: NonNullable<Quote["coupon"]>["reason_code"], message: string, status: "invalid" | "not_applied" = "invalid") => (coupon = { code, status, reason_code, message });
    if (!p || !c) bad("not_found", "ไม่พบโค้ดนี้");
    else if (!c.is_active || p.status !== "active") bad("inactive", "โค้ดนี้ปิดใช้งานอยู่");
    else if (Date.parse(p.starts_at) > now) bad("not_started", "โค้ดนี้ยังไม่เริ่มใช้งาน");
    else if (p.ends_at && Date.parse(p.ends_at) <= now) bad("expired", "โค้ดนี้หมดอายุแล้ว");
    else if (p.usage_limit !== null && p.used_count >= p.usage_limit) bad("usage_limit_reached", "โค้ดนี้ถูกใช้ครบจำนวนแล้ว");
    else if (p.per_customer_limit !== null && !user) bad("login_required", "กรุณาเข้าสู่ระบบเพื่อใช้โค้ดนี้");
    else if (!audienceOk(p, user)) bad("not_eligible_audience", "โค้ดนี้ใช้ได้เฉพาะกลุ่มลูกค้าที่กำหนด", "not_applied");
    else if (eligible(p) <= 0) bad("no_eligible_items", "ไม่มีสินค้าที่ร่วมรายการในตะกร้า", "not_applied");
    else if (eligible(p) < p.min_spend_satang) bad("min_spend_not_met", `ยอดซื้อขั้นต่ำ ฿${(p.min_spend_satang / 100).toLocaleString("th-TH")}`, "not_applied");
    else if (p.kind === "free_shipping") shipCode = { p, code };
    else {
      const a = cartAmount(p, eligible(p));
      if (p.exclusive && l3 && a <= l3.amount) bad("exclusive_not_better", `ใช้ร่วมกับโปรอื่นไม่ได้ และ "${l3.p.label}" คุ้มกว่า`, "not_applied");
      else {
        if (p.exclusive) l3 = null;
        l4 = { p, amount: a, code };
        coupon = { code, status: "applied", reason_code: "", message: `ใช้โค้ด ${code} แล้ว ลด ฿${(a / 100).toLocaleString("th-TH", { minimumFractionDigits: a % 100 ? 2 : 0 })}` };
      }
    }
  }
  const adjustments: Adjustment[] = [];
  if (l3) adjustments.push({ promotion_id: l3.p.id, layer: 3, label: l3.p.label, amount_satang: l3.amount });
  if (l4) adjustments.push({ promotion_id: l4.p.id, layer: 4, label: l4.p.label, amount_satang: l4.amount, coupon_code: l4.code });
  const discount = adjustments.reduce((s, a) => s + a.amount_satang, 0);

  // layer 5
  const fee = req.postal_code ? 4000 : 0;
  const shipping: Quote["shipping"] = { fee_satang: fee, discount_satang: 0 };
  const afterDisc = subtotal - discount;
  const autoShip = live.filter((x) => x.layer === 5 && audienceOk(x, user)).sort(byPrio).find((x) => afterDisc >= x.min_spend_satang);
  if (fee > 0 && autoShip) {
    shipping.discount_satang = Math.min(fee, autoShip.max_discount_satang ?? fee);
    shipping.promotion_id = autoShip.id;
    shipping.label = autoShip.label;
    if (shipCode) coupon = { code: shipCode.code, status: "not_applied", reason_code: "shipping_already_free", message: "ได้ส่งฟรีอยู่แล้ว" };
  } else if (fee > 0 && shipCode) {
    shipping.discount_satang = Math.min(fee, shipCode.p.max_discount_satang ?? fee);
    shipping.promotion_id = shipCode.p.id;
    shipping.label = shipCode.p.label;
    coupon = { code: shipCode.code, status: "applied", reason_code: "", message: `ใช้โค้ด ${shipCode.code} แล้ว ส่งฟรี` };
  } else if (fee > 0) {
    const next = live.filter((x) => x.layer === 5).sort((a, b) => a.min_spend_satang - b.min_spend_satang)[0];
    if (next) hints.push({ kind: "free_shipping_gap", message: `ซื้อเพิ่มอีก ฿${((next.min_spend_satang - afterDisc) / 100).toLocaleString("th-TH")} เพื่อรับส่งฟรี`, amount_satang: next.min_spend_satang - afterDisc, promotion_id: next.id });
  }
  if (!user && memberSkipped) hints.push({ kind: "login_for_member_price", message: "เข้าสู่ระบบเพื่อรับราคาสมาชิก/ราคาส่ง" });

  // largest-remainder allocation of cart-level discount over ok lines
  if (discount > 0 && subtotal > 0) {
    const shares = ok.map((l) => ({ l, exact: (discount * l.line_total_satang) / subtotal }));
    let given = 0;
    shares.forEach((s) => {
      s.l.allocated_discount_satang = Math.floor(s.exact);
      given += s.l.allocated_discount_satang;
    });
    shares.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
    for (let i = 0; given < discount; i++, given++) shares[i % shares.length].l.allocated_discount_satang++;
  }
  const listSub = ok.reduce((s, l) => s + l.qty * l.list_unit_price_satang, 0);
  const shipNet = fee - shipping.discount_satang;
  return {
    lines: lines.map(({ prod, ...l }) => (void prod, l)),
    adjustments,
    shipping,
    totals: {
      list_subtotal_satang: listSub,
      subtotal_satang: subtotal,
      discount_satang: discount,
      shipping_satang: shipNet,
      savings_satang: listSub - subtotal + discount + shipping.discount_satang,
      grand_total_satang: subtotal - discount + shipNet,
    },
    coupon,
    hints,
    quote_hash: `mock-${now}`,
    expires_at: iso(Date.now() + 10 * 60_000),
  };
}

// ---------- uploads ----------
export function mockUpload(path: string, form: FormData): unknown {
  requirePerm("catalog:write");
  const file = form.get("file");
  const url = file instanceof Blob ? URL.createObjectURL(file) : "/mock/canvas-tote.svg";
  const m = path.match(/^\/admin\/products\/(\d+)\/images$/);
  if (m) {
    const p = products.find((x) => x.id === Number(m[1]));
    if (!p) err(404, "not_found", "ไม่พบสินค้า");
    const img: Image = { id: newId(), url, alt: str(form.get("alt")) || p.name, width: 800, height: 800 };
    p.images.push(img);
    refreshProduct(p);
    log("product.image_add", "product", p.id);
    return img;
  }
  return { storage_key: `uploads/${newId()}`, url, width: 1600, height: 600 };
}

// ---------- router ----------
type B = Record<string, unknown>;
type H = (m: RegExpMatchArray, q: Query | undefined, b: B) => unknown;
const R: [string, RegExp, H][] = [];
const on = (method: string, re: RegExp, h: H) => R.push([method, re, h]);

on("GET", /^\/admin\/dashboard$/, () => {
  requirePerm("dashboard:read");
  const paidish = (o: MockOrder) => !["pending_payment", "cancelled"].includes(o.status);
  const today = bkkDay(Date.now());
  const month = today.slice(0, 7);
  const tOrders = orders.filter((o) => bkkDay(o.created_at) === today);
  const mOrders = orders.filter((o) => bkkDay(o.created_at).startsWith(month));
  const sum = (a: MockOrder[]) => a.filter(paidish).reduce((s, o) => s + o.totals.grand_total_satang, 0);
  const sales_7d = Array.from({ length: 7 }, (_, i) => {
    const d = bkkDay(Date.now() - (6 - i) * DAY);
    const os = orders.filter((o) => bkkDay(o.created_at) === d);
    return { date: d, sales_satang: sum(os), orders: os.length };
  });
  const top = new Map<number, { product_id: number; name: string; qty: number; sales_satang: number }>();
  for (const o of mOrders.filter(paidish))
    for (const it of o.items) {
      const f = findVariant(it.variant_id);
      if (!f) continue;
      const t = top.get(f.p.id) ?? { product_id: f.p.id, name: f.p.name, qty: 0, sales_satang: 0 };
      t.qty += it.qty;
      t.sales_satang += it.line_total_satang;
      top.set(f.p.id, t);
    }
  const low = products.flatMap((p) => p.variants.filter((v) => v.is_active && v.stock <= v.low_stock_threshold).map((v) => ({ variant_id: v.id, sku: v.sku, product_name: `${p.name} (${v.name})`, stock: v.stock })));
  const d: Dashboard = {
    today: { sales_satang: sum(tOrders), orders: tOrders.length, paid_orders: tOrders.filter(paidish).length },
    month: { sales_satang: sum(mOrders), orders: mOrders.length },
    pending: { to_pack: orders.filter((o) => o.status === "paid" || o.status === "packing").length, pending_payment: orders.filter((o) => o.status === "pending_payment").length },
    low_stock: low.sort((a, b) => a.stock - b.stock).slice(0, 8),
    sales_7d,
    top_products: [...top.values()].sort((a, b) => b.sales_satang - a.sales_satang).slice(0, 5),
  };
  return { data: d };
});

// catalog
on("GET", /^\/admin\/products$/, (_m, q) => {
  requirePerm("catalog:read");
  let rows = products.filter((p) => p.status !== "archived" || q?.status === "archived");
  if (has(q, "status")) rows = rows.filter((p) => p.status === q!.status);
  if (has(q, "category_id")) {
    const cid = Number(q!.category_id);
    rows = rows.filter((p) => p.category.id === cid || categories.find((c) => c.id === p.category.id)?.parent_id === cid);
  }
  if (q?.low_stock === true || q?.low_stock === "true") rows = rows.filter((p) => p.variants.some((v) => v.is_active && v.stock <= v.low_stock_threshold));
  rows = rows.filter((p) => matchesQ(q, p.name, p.name_en, p.slug, ...p.variants.map((v) => v.sku)));
  const out = rows.map(productRow);
  if (q?.sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, "th"));
  else if (q?.sort === "stock") out.sort((a, b) => a.total_stock - b.total_stock);
  else out.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
  return paginate(out, q, 20);
});
const getP = (id: string) => products.find((p) => p.id === Number(id)) ?? err(404, "not_found", "ไม่พบสินค้า");
function validateProduct(b: B, selfId?: number) {
  const fields: Record<string, string> = {};
  if (b.name !== undefined && !str(b.name).trim()) fields.name = "กรุณากรอกชื่อสินค้า";
  if (b.slug && products.some((p) => p.slug === b.slug && p.id !== selfId)) err(409, "conflict", "slug นี้ถูกใช้แล้ว", { slug: "slug นี้ถูกใช้แล้ว" });
  if (Object.keys(fields).length) err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", fields);
}
function skuTaken(sku: string, selfVid?: number) {
  return products.some((p) => p.variants.some((v) => v.sku.toUpperCase() === sku.toUpperCase() && v.id !== selfVid));
}
function applyProduct(p: AdminProduct, b: B) {
  const s = (k: string) => (b[k] !== undefined ? str(b[k]) : undefined);
  if (s("name") !== undefined) p.name = s("name")!;
  if (s("name_en") !== undefined) p.name_en = s("name_en")!;
  if (s("slug")) p.slug = s("slug")!;
  if (s("subtitle") !== undefined) p.subtitle = s("subtitle")!;
  if (s("description") !== undefined) p.description = s("description")!;
  if (s("brand") !== undefined) p.brand = s("brand")!;
  if (b.category_id !== undefined) p.category = catRef(Number(b.category_id));
  if (b.status !== undefined) p.status = b.status as AdminProduct["status"];
  if (b.featured !== undefined) p.featured = Boolean(b.featured);
  if (Array.isArray(b.tags)) p.tags = b.tags as string[];
  if (Array.isArray(b.options)) p.options = b.options as AdminProduct["options"];
  if (b.seo_title !== undefined || b.seo_description !== undefined) p.seo = { title: str(b.seo_title ?? p.seo.title), description: str(b.seo_description ?? p.seo.description) };
}
function mkVariantFromBody(b: B): AdminVariant {
  const sku = str(b.sku).trim();
  if (!sku) err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", { sku: "กรุณากรอก SKU" });
  if (skuTaken(sku)) err(409, "conflict", `SKU ${sku} ถูกใช้แล้ว`, { sku: "SKU นี้ถูกใช้แล้ว" });
  const v = mkVariant(newId(), sku, (b.option_values as Record<string, string>) ?? {}, Number(b.price_satang ?? 0), Number(b.stock ?? 0), null);
  v.name = str(b.name) || v.name;
  v.weight_grams = Number(b.weight_grams ?? 0);
  v.barcode = str(b.barcode);
  v.low_stock_threshold = Number(b.low_stock_threshold ?? 5);
  v.cost_satang = b.cost_satang === undefined || b.cost_satang === null ? null : Number(b.cost_satang);
  priceHistory.set(v.id, [{ price_satang: v.price_satang, changed_at: iso(Date.now()) }]);
  return v;
}
on("POST", /^\/admin\/products$/, (_m, _q, b) => {
  requirePerm("catalog:write");
  validateProduct(b);
  const id = newId();
  const p = baseProduct({ ...productListFx.data[0], id, slug: str(b.slug) || `product-${id}`, flash: null, image: null, rating_avg: 0, rating_count: 0, sold_count: 0, badges: [] } as unknown as Card, Number(b.category_id), [], [], []);
  applyProduct(p, b);
  p.reviews_summary = { rating_avg: 0, rating_count: 0, histogram: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }, with_images_count: 0 };
  p.created_at = iso(Date.now());
  p.variants = ((b.variants as B[]) ?? []).map(mkVariantFromBody);
  refreshProduct(p);
  products.unshift(p);
  log("product.create", "product", p.id, { name: p.name });
  return { data: p };
});
on("GET", /^\/admin\/products\/(\d+)$/, (m) => (requirePerm("catalog:read"), { data: getP(m[1]) }));
on("PATCH", /^\/admin\/products\/(\d+)$/, (m, _q, b) => {
  requirePerm("catalog:write");
  const p = getP(m[1]);
  validateProduct(b, p.id);
  applyProduct(p, b);
  refreshProduct(p);
  log("product.update", "product", p.id, { fields: Object.keys(b) });
  return { data: p };
});
on("DELETE", /^\/admin\/products\/(\d+)$/, (m) => {
  requirePerm("catalog:write");
  const p = getP(m[1]);
  p.status = "archived";
  log("product.archive", "product", p.id);
  return undefined;
});
on("POST", /^\/admin\/products\/(\d+)\/variants$/, (m, _q, b) => {
  requirePerm("catalog:write");
  const p = getP(m[1]);
  const v = mkVariantFromBody(b);
  p.variants.push(v);
  refreshProduct(p);
  log("variant.create", "variant", v.id, { sku: v.sku });
  return { data: v };
});
on("PATCH", /^\/admin\/variants\/(\d+)$/, (m, _q, b) => {
  requirePerm("catalog:write");
  const f = findVariant(Number(m[1])) ?? err(404, "not_found", "ไม่พบตัวเลือกสินค้า");
  const { p, v } = f;
  if (b.sku !== undefined && skuTaken(str(b.sku), v.id)) err(409, "conflict", "SKU นี้ถูกใช้แล้ว", { sku: "SKU นี้ถูกใช้แล้ว" });
  if (b.price_satang !== undefined && Number(b.price_satang) !== v.price_satang) priceHistory.get(v.id)?.push({ price_satang: Number(b.price_satang), changed_at: iso(Date.now()) });
  for (const k of ["sku", "name", "barcode"] as const) if (b[k] !== undefined) v[k] = str(b[k]);
  for (const k of ["price_satang", "weight_grams", "low_stock_threshold"] as const) if (b[k] !== undefined) v[k] = Number(b[k]);
  if (b.cost_satang !== undefined) v.cost_satang = b.cost_satang === null ? null : Number(b.cost_satang);
  if (b.option_values !== undefined) v.option_values = b.option_values as Record<string, string>;
  if (b.is_active !== undefined) v.is_active = Boolean(b.is_active);
  refreshProduct(p);
  log("variant.update", "variant", v.id, { fields: Object.keys(b) });
  return { data: v };
});
on("DELETE", /^\/admin\/variants\/(\d+)$/, (m) => {
  requirePerm("catalog:write");
  const f = findVariant(Number(m[1])) ?? err(404, "not_found", "ไม่พบตัวเลือกสินค้า");
  const referenced = orders.some((o) => o.items.some((i) => i.variant_id === f.v.id));
  if (referenced) f.v.is_active = false;
  else f.p.variants = f.p.variants.filter((v) => v.id !== f.v.id);
  refreshProduct(f.p);
  log(referenced ? "variant.deactivate" : "variant.delete", "variant", f.v.id);
  return undefined;
});
on("GET", /^\/admin\/variants\/(\d+)\/price-history$/, (m) => (requirePerm("catalog:read"), { data: priceHistory.get(Number(m[1])) ?? [] }));
on("PUT", /^\/admin\/products\/(\d+)\/images\/order$/, (m, _q, b) => {
  requirePerm("catalog:write");
  const p = getP(m[1]);
  const ids = (b.image_ids as number[]) ?? [];
  p.images.sort((a, c) => ids.indexOf(a.id) - ids.indexOf(c.id));
  refreshProduct(p);
  log("product.images_order", "product", p.id);
  return undefined;
});
const findImage = (id: number) => {
  for (const p of products) {
    const img = p.images.find((i) => i.id === id);
    if (img) return { p, img };
  }
  return err(404, "not_found", "ไม่พบรูปภาพ");
};
on("PATCH", /^\/admin\/images\/(\d+)$/, (m, _q, b) => {
  requirePerm("catalog:write");
  const { img } = findImage(Number(m[1]));
  if (b.alt !== undefined) img.alt = str(b.alt);
  return { data: img };
});
on("DELETE", /^\/admin\/images\/(\d+)$/, (m) => {
  requirePerm("catalog:write");
  const { p, img } = findImage(Number(m[1]));
  p.images = p.images.filter((i) => i.id !== img.id);
  refreshProduct(p);
  log("product.image_delete", "product", p.id);
  return undefined;
});

on("GET", /^\/admin\/categories$/, (_m, q) => {
  requirePerm("catalog:read");
  const rows = categories.map((c) => ({ ...c, product_count: products.filter((p) => p.status !== "archived" && (p.category.id === c.id || categories.find((x) => x.id === p.category.id)?.parent_id === c.id)).length }));
  rows.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  return paginate(rows, q, 100);
});
function checkCategory(b: B, selfId?: number) {
  if (b.slug !== undefined && categories.some((c) => c.slug === b.slug && c.id !== selfId)) err(409, "conflict", "slug นี้ถูกใช้แล้ว", { slug: "slug นี้ถูกใช้แล้ว" });
  if (b.parent_id) {
    const parent = categories.find((c) => c.id === Number(b.parent_id));
    if (!parent || parent.parent_id !== null) err(422, "validation_failed", "หมวดหมู่มีได้สูงสุด 2 ชั้น", { parent_id: "เลือกได้เฉพาะหมวดหลัก" });
    if (selfId && categories.some((c) => c.parent_id === selfId)) err(422, "validation_failed", "หมวดที่มีหมวดย่อยย้ายไปอยู่ใต้หมวดอื่นไม่ได้", { parent_id: "หมวดนี้มีหมวดย่อยอยู่" });
  }
}
on("POST", /^\/admin\/categories$/, (_m, _q, b) => {
  requirePerm("catalog:write");
  checkCategory(b);
  const c: AdminCategory = { id: newId(), slug: str(b.slug), name: str(b.name), parent_id: b.parent_id ? Number(b.parent_id) : null, description: str(b.description), image_url: str(b.image_url), icon: str(b.icon), sort_order: Number(b.sort_order ?? 99), is_active: b.is_active !== false, seo_title: str(b.seo_title), seo_description: str(b.seo_description) };
  categories.push(c);
  log("category.create", "category", c.id, { name: c.name });
  return { data: c };
});
on("PATCH", /^\/admin\/categories\/(\d+)$/, (m, _q, b) => {
  requirePerm("catalog:write");
  const c = categories.find((x) => x.id === Number(m[1])) ?? err(404, "not_found", "ไม่พบหมวดหมู่");
  checkCategory(b, c.id);
  Object.assign(c, b, b.parent_id !== undefined ? { parent_id: b.parent_id ? Number(b.parent_id) : null } : {});
  log("category.update", "category", c.id, { fields: Object.keys(b) });
  return { data: c };
});
on("DELETE", /^\/admin\/categories\/(\d+)$/, (m) => {
  requirePerm("catalog:write");
  const id = Number(m[1]);
  if (categories.some((c) => c.parent_id === id)) err(409, "conflict", "ลบไม่ได้: หมวดนี้ยังมีหมวดย่อย");
  if (products.some((p) => p.category.id === id && p.status !== "archived")) err(409, "conflict", "ลบไม่ได้: ยังมีสินค้าในหมวดนี้");
  categories.splice(categories.findIndex((c) => c.id === id), 1);
  log("category.delete", "category", id);
  return undefined;
});

on("GET", /^\/admin\/inventory$/, (_m, q) => {
  requirePerm("catalog:read");
  const rows: InventoryRow[] = [];
  for (const p of products.filter((x) => x.status !== "archived"))
    for (const v of p.variants.filter((x) => x.is_active)) {
      const reserved = orders.filter((o) => o.status === "pending_payment").flatMap((o) => o.items).filter((i) => i.variant_id === v.id).reduce((s, i) => s + i.qty, 0);
      rows.push({ variant_id: v.id, product_id: p.id, product_name: p.name, sku: v.sku, variant_name: v.name, stock: v.stock, low_stock_threshold: v.low_stock_threshold, reserved_qty: reserved });
    }
  let out = rows.filter((r) => matchesQ(q, r.product_name, r.sku, r.variant_name));
  if (q?.low_stock === true || q?.low_stock === "true") out = out.filter((r) => r.stock <= r.low_stock_threshold);
  out.sort((a, b) => a.stock - b.stock || a.variant_id - b.variant_id);
  return paginate(out, q, 50);
});
on("POST", /^\/admin\/inventory\/adjust$/, (_m, _q, b) => {
  requirePerm("inventory:write");
  const f = findVariant(Number(b.variant_id)) ?? err(404, "not_found", "ไม่พบสินค้า");
  const delta = Number(b.delta);
  if (!Number.isInteger(delta) || delta === 0) err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", { delta: "จำนวนต้องเป็นจำนวนเต็มและไม่เป็น 0" });
  if (!str(b.reason).trim()) err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", { reason: "กรุณาระบุเหตุผล" });
  if (f.v.stock + delta < 0) err(409, "conflict", `สต็อกไม่พอ (คงเหลือ ${f.v.stock})`);
  f.v.stock += delta;
  refreshProduct(f.p);
  log("inventory.adjust", "variant", f.v.id, { delta, reason: b.reason, stock: f.v.stock });
  return { data: { variant_id: f.v.id, stock: f.v.stock } };
});

on("GET", /^\/admin\/reviews$/, (_m, q) => {
  requirePerm("reviews:moderate");
  let rows = [...reviews];
  if (has(q, "status")) rows = rows.filter((r) => r.status === q!.status);
  if (has(q, "rating")) rows = rows.filter((r) => r.rating === Number(q!.rating));
  if (has(q, "product_id")) rows = rows.filter((r) => r.product.id === Number(q!.product_id));
  rows = rows.filter((r) => matchesQ(q, r.body, r.title, r.product.name, r.author_name));
  rows.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return paginate(rows, q, 20);
});
on("PATCH", /^\/admin\/reviews\/(\d+)$/, (m, _q, b) => {
  requirePerm("reviews:moderate");
  const r = reviews.find((x) => x.id === Number(m[1])) ?? err(404, "not_found", "ไม่พบรีวิว");
  if (b.status) r.status = b.status as AdminReview["status"];
  if (b.reply_body !== undefined) r.reply = str(b.reply_body).trim() ? { body: str(b.reply_body), replied_at: iso(Date.now()) } : null;
  log(b.status ? `review.${b.status === "hidden" ? "hide" : "publish"}` : "review.reply", "review", r.id);
  return { data: r };
});

// promotions
on("GET", /^\/admin\/promotions$/, (_m, q) => {
  requirePerm("promotions:read");
  let rows = promotions.map((p) => ({ ...p, state: promoState(p) }));
  if (has(q, "kind")) rows = rows.filter((p) => str(q!.kind).split(",").includes(p.kind));
  if (has(q, "layer")) rows = rows.filter((p) => str(q!.layer).split(",").map(Number).includes(p.layer));
  if (has(q, "state")) rows = rows.filter((p) => str(q!.state).split(",").includes(p.state));
  if (has(q, "campaign_id")) rows = rows.filter((p) => p.campaign?.id === Number(q!.campaign_id));
  rows = rows.filter((p) => matchesQ(q, p.name, p.label, ...p.codes.map((c) => c.code)));
  rows.sort((a, b) => a.layer - b.layer || b.priority - a.priority || a.id - b.id);
  return paginate(rows, q, 50);
});
on("POST", /^\/admin\/promotions\/preview$/, (_m, _q, b) => (requirePerm("promotions:read"), { data: mockPrice(b as unknown as PreviewRequest) }));
const getPromo = (id: string) => promotions.find((p) => p.id === Number(id)) ?? err(404, "not_found", "ไม่พบโปรโมชัน");
function targetName(t: { type: string; id: number }) {
  if (t.type === "category") return categories.find((c) => c.id === t.id)?.name ?? `#${t.id}`;
  if (t.type === "product") return products.find((p) => p.id === t.id)?.name ?? `#${t.id}`;
  const f = findVariant(t.id);
  return f ? `${f.p.name} (${f.v.name})` : `#${t.id}`;
}
function applyPromo(p: AdminPromotion, b: B) {
  const { targets, campaign_id, codes, ...rest } = b as B & { targets?: { type: "category" | "product" | "variant"; id: number }[]; campaign_id?: number | null; codes?: string[] };
  Object.assign(p, rest);
  if (targets) p.targets = targets.map((t) => ({ ...t, name: targetName(t) }));
  if (campaign_id !== undefined) p.campaign = campRef(campaign_id);
  if (codes?.length) {
    for (const c of codes) {
      const code = c.toUpperCase();
      if (promotions.some((x) => x.codes.some((y) => y.code === code))) err(409, "conflict", `โค้ด ${code} ถูกใช้แล้ว`, { codes: `โค้ด ${code} ถูกใช้แล้ว` });
      p.codes.push({ id: ++nextCodeId, code, is_active: true });
    }
  }
  const withCode = p.codes.length > 0 || b.auto_apply === false;
  const k = p.kind;
  p.layer = k === "quantity_break" || k === "group_price" || k === "tier_price" ? 1 : k === "buy_x_get_y" ? 2 : withCode && !p.auto_apply ? 4 : k === "free_shipping" ? 5 : 3;
  p.updated_at = iso(Date.now());
  p.state = promoState(p);
}
on("POST", /^\/admin\/promotions$/, (_m, _q, b) => {
  requirePerm("promotions:write");
  if (!str(b.name).trim()) err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", { name: "กรุณากรอกชื่อโปรโมชัน" });
  const p: AdminPromotion = { ...promoTemplate, id: newId(), qty_tiers: [], targets: [], codes: [], customer_group_ids: [], tiers: [], used_count: 0, campaign: null, created_at: iso(Date.now()), status: "draft" } as AdminPromotion;
  applyPromo(p, b);
  promotions.push(p);
  log("promotion.create", "promotion", p.id, { name: p.name });
  return { data: p };
});
on("GET", /^\/admin\/promotions\/(\d+)$/, (m) => (requirePerm("promotions:read"), { data: { ...getPromo(m[1]), state: promoState(getPromo(m[1])) } }));
on("PATCH", /^\/admin\/promotions\/(\d+)$/, (m, _q, b) => {
  requirePerm("promotions:write");
  const p = getPromo(m[1]);
  applyPromo(p, b);
  log("promotion.update", "promotion", p.id, { fields: Object.keys(b) });
  return { data: p };
});
on("DELETE", /^\/admin\/promotions\/(\d+)$/, (m) => {
  requirePerm("promotions:write");
  const p = getPromo(m[1]);
  if (p.used_count > 0) {
    p.status = "archived";
    p.state = "archived";
  } else promotions.splice(promotions.indexOf(p), 1);
  log(p.used_count > 0 ? "promotion.archive" : "promotion.delete", "promotion", p.id);
  return undefined;
});
on("POST", /^\/admin\/promotions\/(\d+)\/codes$/, (m, _q, b) => {
  requirePerm("promotions:write");
  const p = getPromo(m[1]);
  if (p.layer !== 4) err(422, "validation_failed", "เพิ่มโค้ดได้เฉพาะโปรแบบใช้โค้ด");
  let list: string[] = (b.codes as string[]) ?? [];
  const g = b.generate as { count: number; prefix: string; length: number } | undefined;
  if (g) {
    if (g.count < 1 || g.count > 500) err(422, "validation_failed", "กรุณาตรวจสอบข้อมูล", { count: "สร้างได้ 1–500 โค้ดต่อครั้ง" });
    list = [];
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    while (list.length < g.count) {
      let s = g.prefix.toUpperCase();
      for (let i = 0; i < g.length; i++) s += A[Math.floor(Math.random() * A.length)];
      if (!list.includes(s)) list.push(s);
    }
  }
  const added = [];
  for (const c of list) {
    const code = c.toUpperCase();
    if (promotions.some((x) => x.codes.some((y) => y.code === code))) err(409, "conflict", `โค้ด ${code} ถูกใช้แล้ว`);
    const row = { id: ++nextCodeId, code, is_active: true };
    p.codes.push(row);
    added.push(row);
  }
  log("promotion.codes_add", "promotion", p.id, { count: added.length });
  return { data: added };
});
on("DELETE", /^\/admin\/coupon-codes\/(\d+)$/, (m) => {
  requirePerm("promotions:write");
  for (const p of promotions) {
    const c = p.codes.find((x) => x.id === Number(m[1]));
    if (c) {
      c.is_active = false;
      log("coupon_code.deactivate", "coupon_code", c.id, { code: c.code });
      return undefined;
    }
  }
  return err(404, "not_found", "ไม่พบโค้ด");
});
on("GET", /^\/admin\/promotions\/(\d+)\/redemptions$/, (m, q) => {
  requirePerm("promotions:read");
  const p = getPromo(m[1]);
  const rows = orders.slice(0, Math.min(p.used_count, 30)).map((o, i) => ({ order_no: o.order_no, user_email: o.email, amount_satang: p.amount_satang ?? pctOf(o.totals.subtotal_satang, p.percent_bp ?? 0), status: i % 9 === 8 ? "released" : "confirmed", created_at: o.created_at }));
  return paginate(rows, q, 10);
});

// flash sales
function enrichFlash(f: AdminFlashSale) {
  return f;
}
on("GET", /^\/admin\/flash-sales$/, (_m, q) => {
  requirePerm("promotions:read");
  const rows = flashSales.filter((f) => matchesQ(q, f.name, f.label)).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return paginate(rows.map(enrichFlash), q, 50);
});
const getFlash = (id: string) => flashSales.find((f) => f.id === Number(id)) ?? err(404, "not_found", "ไม่พบ Flash Sale");
on("POST", /^\/admin\/flash-sales$/, (_m, _q, b) => {
  requirePerm("promotions:write");
  const f: AdminFlashSale = { id: newId(), name: str(b.name), label: str(b.label) || str(b.name), status: (b.status as AdminFlashSale["status"]) ?? "draft", starts_at: str(b.starts_at), ends_at: str(b.ends_at), campaign_id: (b.campaign_id as number | null) ?? null, items: [] };
  flashSales.push(f);
  log("flash_sale.create", "flash_sale", f.id, { name: f.name });
  return { data: f };
});
on("GET", /^\/admin\/flash-sales\/(\d+)$/, (m) => (requirePerm("promotions:read"), { data: getFlash(m[1]) }));
on("PATCH", /^\/admin\/flash-sales\/(\d+)$/, (m, _q, b) => {
  requirePerm("promotions:write");
  const f = getFlash(m[1]);
  Object.assign(f, b);
  log("flash_sale.update", "flash_sale", f.id, { fields: Object.keys(b) });
  return { data: f };
});
on("DELETE", /^\/admin\/flash-sales\/(\d+)$/, (m) => {
  requirePerm("promotions:write");
  const f = getFlash(m[1]);
  if (f.items.some((i) => i.sold_qty > 0)) f.status = "archived";
  else flashSales.splice(flashSales.indexOf(f), 1);
  log("flash_sale.delete", "flash_sale", f.id);
  return undefined;
});
on("PUT", /^\/admin\/flash-sales\/(\d+)\/items$/, (m, _q, b) => {
  requirePerm("promotions:write");
  const f = getFlash(m[1]);
  const items = (b as unknown as { variant_id: number; sale_price_satang: number; qty_limit: number; per_customer_limit?: number | null; sort_order: number }[]) ?? [];
  const next = items.map((it, i) => {
    const fv = findVariant(it.variant_id) ?? err(404, "not_found", "ไม่พบสินค้า");
    if (it.sale_price_satang >= fv.v.price_satang) err(422, "validation_failed", `ราคา Flash ของ ${fv.v.sku} ต้องต่ำกว่าราคาปกติ`, { [`items.${i}.sale_price_satang`]: "ต้องต่ำกว่าราคาปกติ" });
    const old = f.items.find((x) => x.variant_id === it.variant_id);
    if (old && it.qty_limit < old.sold_qty) err(422, "validation_failed", `จำนวนจำกัดของ ${fv.v.sku} ต่ำกว่าที่ขายไปแล้ว (${old.sold_qty})`, { [`items.${i}.qty_limit`]: "ต่ำกว่าที่ขายไปแล้ว" });
    const clash = flashSales.find((o) => o.id !== f.id && o.status === "active" && Date.parse(o.starts_at) < Date.parse(f.ends_at) && Date.parse(f.starts_at) < Date.parse(o.ends_at) && o.items.some((x) => x.variant_id === it.variant_id));
    if (clash) err(409, "conflict", `${fv.v.sku} อยู่ใน "${clash.name}" ช่วงเวลาเดียวกันแล้ว`);
    return { id: old?.id ?? newId(), variant_id: fv.v.id, sku: fv.v.sku, product_name: fv.p.name, variant_name: fv.v.name, list_price_satang: fv.v.price_satang, sale_price_satang: it.sale_price_satang, qty_limit: it.qty_limit, sold_qty: old?.sold_qty ?? 0, per_customer_limit: it.per_customer_limit ?? null, sort_order: it.sort_order };
  });
  f.items = next;
  log("flash_sale.items", "flash_sale", f.id, { items: next.length });
  return { data: f };
});

// campaigns
on("GET", /^\/admin\/campaigns$/, (_m, q) => (requirePerm("promotions:read"), paginate([...campaigns].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)), q, 100)));
on("POST", /^\/admin\/campaigns$/, (_m, _q, b) => {
  requirePerm("promotions:write");
  if (campaigns.some((c) => c.slug === b.slug)) err(409, "conflict", "slug นี้ถูกใช้แล้ว", { slug: "slug นี้ถูกใช้แล้ว" });
  const c = { ...(b as unknown as AdminCampaign), id: newId() };
  campaigns.push(c);
  log("campaign.create", "campaign", c.id, { name: c.name });
  return { data: c };
});
on("PATCH", /^\/admin\/campaigns\/(\d+)$/, (m, _q, b) => {
  requirePerm("promotions:write");
  const c = campaigns.find((x) => x.id === Number(m[1])) ?? err(404, "not_found", "ไม่พบแคมเปญ");
  if (b.slug && campaigns.some((x) => x.slug === b.slug && x.id !== c.id)) err(409, "conflict", "slug นี้ถูกใช้แล้ว", { slug: "slug นี้ถูกใช้แล้ว" });
  Object.assign(c, b);
  promotions.forEach((p) => p.campaign?.id === c.id && (p.campaign = campRef(c.id)));
  log("campaign.update", "campaign", c.id, { fields: Object.keys(b) });
  return { data: c };
});
on("DELETE", /^\/admin\/campaigns\/(\d+)$/, (m) => {
  requirePerm("promotions:write");
  const id = Number(m[1]);
  campaigns.splice(campaigns.findIndex((c) => c.id === id), 1);
  promotions.forEach((p) => p.campaign?.id === id && (p.campaign = null));
  log("campaign.delete", "campaign", id);
  return undefined;
});

// customer groups
on("GET", /^\/admin\/customer-groups$/, (_m, q) => (requirePerm("customers:read"), groupCounts(), paginate(groups, q, 100)));
on("POST", /^\/admin\/customer-groups$/, (_m, _q, b) => {
  requirePerm("customers:write");
  if (groups.some((g) => g.code === b.code)) err(409, "conflict", "รหัสกลุ่มนี้ถูกใช้แล้ว", { code: "รหัสกลุ่มนี้ถูกใช้แล้ว" });
  const g = { id: newId(), code: str(b.code), name: str(b.name), description: str(b.description), member_count: 0 };
  groups.push(g);
  log("customer_group.create", "customer_group", g.id, { code: g.code });
  return { data: g };
});
on("PATCH", /^\/admin\/customer-groups\/(\d+)$/, (m, _q, b) => {
  requirePerm("customers:write");
  const g = groups.find((x) => x.id === Number(m[1])) ?? err(404, "not_found", "ไม่พบกลุ่ม");
  Object.assign(g, b);
  users.forEach(syncUser);
  log("customer_group.update", "customer_group", g.id);
  return { data: g };
});
on("DELETE", /^\/admin\/customer-groups\/(\d+)$/, (m) => {
  requirePerm("customers:write");
  const id = Number(m[1]);
  groups.splice(groups.findIndex((g) => g.id === id), 1);
  users.forEach((u) => {
    if (u.group_id === id) u.group_id = null;
    syncUser(u);
  });
  log("customer_group.delete", "customer_group", id);
  return undefined;
});

// users
const userOut = ({ group_id, ...u }: (typeof users)[number]): AdminUser => (void group_id, u);
on("GET", /^\/admin\/users$/, (_m, q) => {
  requirePerm("customers:read");
  let rows = users;
  if (has(q, "role")) rows = rows.filter((u) => str(q!.role).split(",").includes(u.role));
  if (has(q, "tier")) rows = rows.filter((u) => u.tier === q!.tier);
  if (has(q, "group_id")) rows = rows.filter((u) => u.group_id === Number(q!.group_id));
  rows = rows.filter((u) => matchesQ(q, u.name, u.email, u.phone));
  return paginate(rows.map(userOut), q, 20);
});
const getU = (id: string) => users.find((u) => u.id === Number(id)) ?? err(404, "not_found", "ไม่พบผู้ใช้");
on("GET", /^\/admin\/users\/(\d+)$/, (m) => {
  requirePerm("customers:read");
  const u = getU(m[1]);
  const mine = orders.filter((o) => o.customer_id === u.id);
  return {
    data: {
      ...userOut(u),
      addresses: mine.length ? [{ ...fxOrder.shipping_address, id: u.id * 10, recipient_name: u.name, phone: u.phone }] : [],
      recent_orders: mine.slice(0, 10).map((o) => ({ order_no: o.order_no, status: o.status, item_count: o.items.reduce((s, i) => s + i.qty, 0), grand_total_satang: o.totals.grand_total_satang, created_at: o.created_at, first_item_image: o.items[0] ? { id: 0, url: o.items[0].image_url, alt: o.items[0].product_name, width: 800, height: 800 } : null })),
    },
  };
});
on("PATCH", /^\/admin\/users\/(\d+)$/, (m, _q, b) => {
  const me = requirePerm("customers:write");
  const u = getU(m[1]);
  if (b.role !== undefined && b.role !== u.role) {
    if (!me.perms.includes("staff:manage")) err(403, "forbidden", "เฉพาะเจ้าของร้านเท่านั้นที่เปลี่ยนบทบาทได้");
    if (u.role === "owner" && users.filter((x) => x.role === "owner" && x.is_active).length <= 1) err(409, "conflict", "ต้องมีเจ้าของร้านอย่างน้อย 1 คน");
    u.role = b.role as Role;
  }
  if (b.is_active === false && u.role === "owner" && users.filter((x) => x.role === "owner" && x.is_active).length <= 1) err(409, "conflict", "ปิดบัญชีเจ้าของร้านคนสุดท้ายไม่ได้");
  if (b.group_id !== undefined) u.group_id = b.group_id === null ? null : Number(b.group_id);
  if (b.tier !== undefined) u.tier = b.tier as Tier;
  if (b.is_active !== undefined) u.is_active = Boolean(b.is_active);
  syncUser(u);
  log("user.update", "user", u.id, b);
  return { data: userOut(u) };
});

// orders
on("GET", /^\/admin\/orders$/, (_m, q) => {
  requirePerm("orders:read");
  let rows = orders;
  if (has(q, "status")) rows = rows.filter((o) => str(q!.status).split(",").includes(o.status));
  if (has(q, "payment_method")) rows = rows.filter((o) => o.payment_method === q!.payment_method);
  if (has(q, "from")) rows = rows.filter((o) => bkkDay(o.created_at) >= str(q!.from).slice(0, 10));
  if (has(q, "to")) rows = rows.filter((o) => bkkDay(o.created_at) <= str(q!.to).slice(0, 10));
  rows = rows.filter((o) => matchesQ(q, o.order_no, o.email, o.customer.name, o.shipping_address.phone));
  return paginate(rows.map(orderRow), q, 20);
});
const getO = (no: string) => orders.find((o) => o.order_no === decodeURIComponent(no)) ?? err(404, "not_found", "ไม่พบคำสั่งซื้อ");
on("GET", /^\/admin\/orders\/([^/]+)$/, (m) => (requirePerm("orders:read"), { data: getO(m[1]) }));
function moveOrder(o: MockOrder, to: OrderStatus, note: string) {
  const from = o.status;
  if (!canTransition(from as OrderStatusKey, to as OrderStatusKey)) err(409, "invalid_state", `เปลี่ยนสถานะจาก "${from}" เป็น "${to}" ไม่ได้`);
  const at = iso(Date.now());
  o.status = to;
  o.timeline.push({ status: to, at, note });
  o.status_history.push({ from_status: from, to_status: to, actor_email: currentMe()?.email ?? null, note, created_at: at });
  if (to === "cancelled") o.cancelled_at = at;
  if (to === "refunded" && o.payment) o.payment.status = "refunded";
  log("order.status", "order", o.order_no, { from, to, note });
}
on("POST", /^\/admin\/orders\/([^/]+)\/status$/, (m, _q, b) => {
  const to = b.to as OrderStatus;
  requirePerm(to === "cancelled" || to === "refunded" ? "orders:manage" : "orders:fulfil");
  const o = getO(m[1]);
  moveOrder(o, to, str(b.note));
  return { data: o };
});
on("POST", /^\/admin\/orders\/([^/]+)\/shipments$/, (m, _q, b) => {
  requirePerm("orders:fulfil");
  const o = getO(m[1]);
  if (o.status !== "packing") err(409, "invalid_state", "สร้างใบส่งได้เฉพาะคำสั่งซื้อที่กำลังแพ็ค");
  const id = newId();
  const tracking_no = `TH${String(Math.floor(1e9 + Math.random() * 9e9))}MK`;
  shipments.set(id, { order_no: o.order_no, tracking_no, fee: 4000 });
  o.shipment = { id, carrier: "flash_mock", tracking_no, status: "created", label_url: `/admin/print/label/${o.order_no}?tracking=${tracking_no}` };
  moveOrder(o, "shipped", `สร้างใบส่ง ${tracking_no}`);
  void b;
  return { data: { id, carrier: "flash_mock", tracking_no, status: "created", label_url: `/admin/print/label/${o.order_no}?tracking=${tracking_no}`, fee_satang: 4000 } };
});

const TRACK_STEPS = ["created", "picked_up", "in_transit", "out_for_delivery", "delivered"];
const TRACK_TEXT: Record<string, string> = { created: "สร้างใบส่งแล้ว", picked_up: "เข้ารับพัสดุแล้ว", in_transit: "อยู่ระหว่างขนส่ง", out_for_delivery: "กำลังนำส่ง", delivered: "ส่งถึงผู้รับแล้ว" };
on("POST", /^\/admin\/shipments\/(\d+)\/mock-advance$/, (m) => {
  requirePerm("orders:fulfil");
  const o = orders.find((x) => (x.shipment as { id?: number } | null)?.id === Number(m[1])) ?? err(404, "not_found", "ไม่พบใบส่ง");
  const sh = o.shipment!;
  const i = Math.min(TRACK_STEPS.length - 1, TRACK_STEPS.indexOf(sh.status) + 1);
  sh.status = TRACK_STEPS[i];
  if (sh.status === "delivered" && o.status === "shipped") moveOrder(o, "delivered", "ขนส่งแจ้งส่งถึงแล้ว");
  const events = TRACK_STEPS.slice(0, i + 1).map((s, k) => ({ status: s, description: TRACK_TEXT[s], location: k ? "ศูนย์คัดแยก บางนา" : "ShopShip", occurred_at: iso(Date.now() - (i - k) * 3600_000) }));
  return { data: { carrier: sh.carrier, tracking_no: sh.tracking_no, status: sh.status, events } };
});

// banners
on("GET", /^\/admin\/banners$/, (_m, q) => {
  requirePerm("banners:write");
  let rows = [...banners];
  if (has(q, "placement")) rows = rows.filter((b) => b.placement === q!.placement);
  rows.sort((a, b) => a.placement.localeCompare(b.placement) || a.sort_order - b.sort_order);
  return paginate(rows, q, 100);
});
on("POST", /^\/admin\/banners$/, (_m, _q, b) => {
  requirePerm("banners:write");
  const x = { ...(b as unknown as AdminBanner), id: newId() };
  banners.push(x);
  log("banner.create", "banner", x.id, { title: x.title });
  return { data: x };
});
on("PATCH", /^\/admin\/banners\/(\d+)$/, (m, _q, b) => {
  requirePerm("banners:write");
  const x = banners.find((y) => y.id === Number(m[1])) ?? err(404, "not_found", "ไม่พบแบนเนอร์");
  Object.assign(x, b);
  log("banner.update", "banner", x.id, { fields: Object.keys(b) });
  return { data: x };
});
on("DELETE", /^\/admin\/banners\/(\d+)$/, (m) => {
  requirePerm("banners:write");
  banners.splice(banners.findIndex((x) => x.id === Number(m[1])), 1);
  log("banner.delete", "banner", m[1]);
  return undefined;
});

on("GET", /^\/admin\/audit-logs$/, (_m, q) => {
  requirePerm("audit:read");
  let rows = audit;
  if (has(q, "action")) rows = rows.filter((a) => a.action.startsWith(str(q!.action)));
  if (has(q, "target_type")) rows = rows.filter((a) => a.target_type === q!.target_type);
  if (has(q, "actor_id")) rows = rows.filter((a) => a.actor?.id === Number(q!.actor_id));
  if (has(q, "from")) rows = rows.filter((a) => bkkDay(a.created_at) >= str(q!.from).slice(0, 10));
  if (has(q, "to")) rows = rows.filter((a) => bkkDay(a.created_at) <= str(q!.to).slice(0, 10));
  return paginate(rows, q, 25);
});

/** Entry point used by web/src/mocks/handler.ts for every /admin/* path. */
export function adminMock(method: string, path: string, query?: Query, body?: unknown): unknown {
  for (const [m, re, h] of R) {
    if (m !== method) continue;
    const match = path.match(re);
    if (match) return h(match, query, (body ?? {}) as B);
  }
  throw new ApiError(501, { code: "not_implemented", message: `ไม่มี mock สำหรับ ${method} ${path}` });
}
