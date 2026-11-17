// Promotions hub E2E (real stack): coupon created through the UI editor, then (through the admin session in the browser)
// a seasonal campaign + code, a trade quantity-break tier for wholesale, a customer group % with an assigned customer,
// a flash sale — each verified against the storefront quote/offers. Then the simulator (UI) vs the real cart quote.
import { launch, newClient, watch, WEB, OUT, sleep, pageApi, text, shot, clickText, USERS } from "./lib.mjs";
import { adminLogin } from "./crawl-admin.mjs";
import { Client } from "./api.mjs";
import fs from "node:fs";
const dir = `${OUT}/promos`;
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
};
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const DAY = 86400e3;

/** type into the input inside the Field whose label text starts with `label` */
async function fill(page, label, value) {
  const h = await page.evaluateHandle((label) => {
    const lab = [...document.querySelectorAll("label, span, p")].find((l) => l.textContent.trim().startsWith(label) && l.closest("div"));
    if (!lab) return null;
    let box = lab.parentElement;
    for (let i = 0; i < 3 && box && !box.querySelector("input, textarea, select"); i++) box = box.parentElement;
    return box?.querySelector("input, textarea, select") ?? null;
  }, label);
  const el = h.asElement();
  if (!el) throw new Error(`fill: no field "${label}"`);
  const tag = await el.evaluate((e) => e.tagName);
  if (tag === "SELECT") await el.select(value);
  else {
    await el.click({ clickCount: 3 });
    await el.type(value);
  }
}

const b = await launch();
const { page } = await newClient(b, { width: 1440, height: 1000 });
const issues = watch(page, "promos");
const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
try {
  await adminLogin(page, "admin");

  // ---------- 1. coupon via the UI editor
  const CODE = `QA50${rnd}`;
  await page.goto(`${WEB}/admin/promotions/new?mode=code&kind=cart_amount`, { waitUntil: "load" });
  await sleep(2500);
  await fill(page, "ชื่อ (ภายใน)", `QA coupon ${rnd}`);
  await fill(page, "ข้อความที่ลูกค้าเห็น", `โค้ด ${CODE} ลด ฿50`);
  await fill(page, "ลดเป็นเงิน", "50");
  const codeArea = (await page.$('input[aria-label="โค้ดใหม่"]')) ?? (await page.$('textarea[placeholder^="SAVE12"]'));
  await codeArea.type(CODE);
  await shot(page, "coupon-editor", { dir, fullPage: true });
  await clickText(page, "บันทึกและเปิดใช้", "button");
  await sleep(3000);
  const created = (await pageApi(page, "GET", `/admin/promotions?q=${encodeURIComponent("QA coupon " + rnd)}`)).data?.[0];
  check("coupon created via UI", created && created.codes?.some((c) => c.code === CODE), JSON.stringify(created && { id: created.id, status: created.status, layer: created.layer, codes: created.codes }));
  if (created && created.status !== "active") await pageApi(page, "PATCH", `/admin/promotions/${created.id}`, { status: "active" });

  // customer applies it (API client = independent browserless session)
  const cust = new Client();
  await cust.login(...USERS.customer);
  for (const it of (await cust.get("/cart")).data.items) await cust.del(`/cart/items/${it.variant_id}`);
  const tee = (await cust.get("/products/cotton-tee-classic")).data;
  const teeV = tee.variants.find((v) => v.in_stock);
  await cust.post("/cart/items", { variant_id: teeV.id, qty: 2 });
  let q = (await cust.post("/cart/quote", { coupon_code: CODE })).data;
  check("new coupon applies in the real cart", q.coupon?.status === "applied" && q.totals.discount_satang >= 5000, `${q.coupon?.status} ${q.coupon?.message}`);

  // ---------- 2. seasonal campaign with a code
  const camp = await pageApi(page, "POST", "/admin/campaigns", {
    slug: `qa-${rnd.toLowerCase()}`, name: `QA Season ${rnd}`, season_tag: "qa", theme: { accent: "#7048E8", accent_contrast: "#FFFFFF", background: "#F3F0FF", hero_image_url: "", badge_text: "QA" },
    starts_at: iso(-DAY), ends_at: iso(3 * DAY), priority: 1, is_active: true,
  });
  check("campaign created", camp.status === 201, `${camp.status} ${JSON.stringify(camp.body).slice(0, 200)}`);
  const SEAS = `QASEAS${rnd}`;
  const seas = await pageApi(page, "POST", "/admin/promotions", {
    name: `QA seasonal ${rnd}`, label: `โค้ดเทศกาล ${SEAS} ลด 7%`, description: "", kind: "cart_percent", status: "active",
    starts_at: iso(-DAY), ends_at: iso(3 * DAY), priority: 5, exclusive: false, auto_apply: false, percent_bp: 700, min_spend_satang: 0,
    max_discount_satang: null, usage_limit: 100, per_customer_limit: 1, customer_group_ids: [], tiers: [], targets: [], campaign_id: camp.data?.id, season_tag: "qa", codes: [SEAS],
  });
  check("seasonal code promotion created", seas.status === 201, `${seas.status} ${JSON.stringify(seas.body).slice(0, 300)}`);
  q = (await cust.post("/cart/quote", { coupon_code: SEAS })).data;
  check("seasonal code applies", q.coupon?.status === "applied", `${q.coupon?.status} ${q.coupon?.message}`);

  // ---------- 3. trade quantity-break tier for wholesale (3+ = ฿200 on the tee)
  const groups = (await pageApi(page, "GET", "/admin/customer-groups?per_page=100")).data;
  const wholesale = groups.find((g) => g.code === "wholesale");
  const trade = await pageApi(page, "POST", "/admin/promotions", {
    name: `QA trade ${rnd}`, label: "ราคาส่ง QA 3+ ชิ้น", description: "", kind: "quantity_break", status: "active", starts_at: iso(-DAY), ends_at: null,
    priority: 50, exclusive: false, auto_apply: true, min_spend_satang: 0, customer_group_ids: [wholesale.id], tiers: [],
    qty_tiers: [{ min_qty: 3, unit_price_satang: 20000, percent_bp: null }], targets: [{ type: "product", id: tee.id }], codes: [],
  });
  check("trade tier created", trade.status === 201, `${trade.status} ${JSON.stringify(trade.body).slice(0, 300)}`);
  const ws = new Client();
  await ws.login(...USERS.wholesale);
  const off = (await ws.get(`/offers?variant_ids=${teeV.id}`)).data?.[0];
  check("wholesale /offers shows the new 3+ tier at ฿200", off?.qty_breaks?.some((x) => x.min_qty === 3 && x.unit_price_satang === 20000), JSON.stringify(off?.qty_breaks));
  for (const it of (await ws.get("/cart")).data.items) await ws.del(`/cart/items/${it.variant_id}`);
  await ws.post("/cart/items", { variant_id: teeV.id, qty: 3 });
  const wq = (await ws.post("/cart/quote", {})).data;
  check("wholesale cart uses the trade tier", wq.lines[0].unit_price_satang === 20000 && wq.lines[0].price_source.kind === "quantity_break", JSON.stringify(wq.lines[0].price_source));

  // ---------- 4. customer group % + assign a customer
  const grp = await pageApi(page, "POST", "/admin/customer-groups", { code: `qa${rnd.toLowerCase()}`, name: `QA กลุ่ม ${rnd}`, description: "QA" });
  check("customer group created", grp.status === 201, `${grp.status}`);
  const gp = await pageApi(page, "POST", "/admin/promotions", {
    name: `QA group ${rnd}`, label: `ราคากลุ่ม QA ลด 20%`, description: "", kind: "group_price", status: "active", starts_at: iso(-DAY), ends_at: null,
    priority: 10, exclusive: false, auto_apply: true, percent_bp: 2000, min_spend_satang: 0, customer_group_ids: [grp.data.id], tiers: [], targets: [], codes: [],
  });
  check("group % promotion created", gp.status === 201, `${gp.status} ${JSON.stringify(gp.body).slice(0, 200)}`);
  const email = `qa.${rnd.toLowerCase()}@example.com`;
  const nu = new Client();
  const reg = await nu.post("/auth/register", { email, password: "Qa-Pass-2026!", name: "คิวเอ ทดสอบ", marketing_consent: false });
  check("register new customer", reg.status === 201, `${reg.status}`);
  const uid = reg.data.id;
  const asg = await pageApi(page, "PATCH", `/admin/users/${uid}`, { group_id: grp.data.id });
  check("assign customer to group", asg.status === 200 && asg.data?.group?.id === grp.data.id, `${asg.status}`);
  const nuOff = (await nu.get(`/offers?variant_ids=${teeV.id}`)).data?.[0];
  check("assigned customer gets 20% group price", nuOff?.price_source?.kind === "group_price" && nuOff.price_satang === Math.round(teeV.price_satang * 0.8), JSON.stringify(nuOff?.price_source) + " " + nuOff?.price_satang);

  // ---------- 5. flash sale (used by the concurrency test): 10 units, 1 per customer
  const prods = (await pageApi(page, "GET", "/products?per_page=48&sort=price_asc")).data;
  const flashTaken = new Set(((await pageApi(page, "GET", "/flash-sales/current")).data?.current?.items ?? []).map((i) => i.product.id));
  const fp = prods.find((p) => !flashTaken.has(p.id) && p.in_stock && p.min_price_satang >= 10000 && !p.flash);
  const fpd = (await pageApi(page, "GET", `/products/${fp.slug}`)).data;
  const fv = fpd.variants.find((v) => v.in_stock);
  // make sure stock is not the limit
  const inv = await pageApi(page, "POST", "/admin/inventory/adjust", { variant_id: fv.id, delta: 200, reason: "QA concurrency stock" });
  check("inventory adjust +200", inv.status === 200, `${inv.status} stock=${inv.data?.stock}`);
  const fs1 = await pageApi(page, "POST", "/admin/flash-sales", { name: `QA flash ${rnd}`, label: "QA Flash", status: "active", starts_at: iso(-60e3), ends_at: iso(DAY), campaign_id: null });
  check("flash sale created", fs1.status === 201, `${fs1.status} ${JSON.stringify(fs1.body).slice(0, 200)}`);
  const items = await pageApi(page, "PUT", `/admin/flash-sales/${fs1.data.id}/items`, [{ variant_id: fv.id, sale_price_satang: Math.floor(fv.price_satang / 2), qty_limit: 10, per_customer_limit: 1, sort_order: 1 }]);
  const items2 = items.status === 200 ? items : await pageApi(page, "PUT", `/admin/flash-sales/${fs1.data.id}/items`, { items: [{ variant_id: fv.id, sale_price_satang: Math.floor(fv.price_satang / 2), qty_limit: 10, per_customer_limit: 1, sort_order: 1 }] });
  check("flash items set (10 units)", items2.status === 200, `${items.status}/${items2.status} ${JSON.stringify(items2.body).slice(0, 200)}`);
  fs.writeFileSync(`${OUT}/flash-variant.json`, JSON.stringify({ variant_id: fv.id, slug: fp.slug, flash_sale_id: fs1.data.id }));

  // ---------- hub UI shows them
  for (const [tab, needle] of [["coupons", CODE], ["campaigns", `QA Season ${rnd}`], ["trade", `QA trade ${rnd}`], ["flash", `QA flash ${rnd}`]]) {
    await page.goto(`${WEB}/admin/promotions?tab=${tab}`, { waitUntil: "load" });
    await sleep(2500);
    check(`hub tab ${tab} lists the new item`, (await text(page)).includes(needle));
    await shot(page, `hub-${tab}`, { dir, fullPage: true });
  }
  await page.goto(`${WEB}/admin/customer-groups`, { waitUntil: "load" });
  await sleep(2000);
  check("customer groups page lists the group", (await text(page)).includes(`QA กลุ่ม ${rnd}`));

  // ---------- simulator (UI) vs real cart quote: wholesale user, tee x3 + tote x12, code FREESHIP11? use 1111SALE
  await page.goto(`${WEB}/admin/promotions?tab=simulator`, { waitUntil: "load" });
  await sleep(2500);
  await clickText(page, "ขายส่ง 12 ชิ้น + ส่งฟรี", "button");
  await sleep(2500);
  const prevP = page.waitForResponse((r) => r.url().includes("/admin/promotions/preview"), { timeout: 15000 });
  await clickText(page, "คำนวณ", "button");
  const prevRes = await prevP;
  const preview = (await prevRes.json()).data;
  await sleep(1200);
  const simText = await text(page);
  await shot(page, "simulator", { dir, fullPage: true });
  // same cart for the real wholesale user
  for (const it of (await ws.get("/cart")).data.items) await ws.del(`/cart/items/${it.variant_id}`);
  for (const l of preview.lines) await ws.post("/cart/items", { variant_id: l.variant_id, qty: l.qty });
  const real = (await ws.post("/cart/quote", { postal_code: "10110" })).data;
  const same = JSON.stringify(real.totals) === JSON.stringify(preview.totals) && JSON.stringify(real.adjustments) === JSON.stringify(preview.adjustments);
  check("simulator preview == real cart quote (wholesale)", same, `preview=${JSON.stringify(preview.totals)} real=${JSON.stringify(real.totals)}`);
  const fmt = (s) => "฿" + (s / 100).toLocaleString("en-US", { minimumFractionDigits: s % 100 ? 2 : 0, maximumFractionDigits: 2 });
  check("simulator UI shows the grand total", simText.includes(fmt(preview.totals.grand_total_satang)), fmt(preview.totals.grand_total_satang));

  // audit log
  const audit = (await pageApi(page, "GET", "/admin/audit-logs?per_page=50")).data ?? [];
  const actions = [...new Set(audit.map((a) => a.action))];
  check("audit log has promotion/campaign/flash/user/inventory entries", ["promotion", "campaign", "flash", "inventory"].every((k) => actions.some((a) => a.includes(k))), actions.join(","));
  await page.goto(`${WEB}/admin/audit`, { waitUntil: "load" });
  await sleep(2000);
  await shot(page, "audit", { dir });
} catch (e) {
  check("script error", false, e.stack);
  await shot(page, "error", { dir, fullPage: true });
}
const bad = issues.filter((i) => !(i.kind === "http.401" && i.text.includes("/auth/me")));
console.log("issues:", bad.length);
for (const i of bad.slice(0, 20)) console.log(" ", i.kind, i.text.slice(0, 200), "@", i.url.replace(WEB, ""));
fs.writeFileSync(`${OUT}/promos-results.json`, JSON.stringify({ results, issues }, null, 2));
await b.close();
