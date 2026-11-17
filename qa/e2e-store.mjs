// Storefront E2E against the real stack: guest add → login merge → promo layers/codes → checkout → PromptPay → paid,
// plus card success / 3DS approve / failure. Writes qa/out/store/*.png and prints PASS/FAIL lines.
import { launch, newClient, watch, WEB, OUT, sleep, pageApi, uiLogin, waitText, clickText, text, shot, brokenImages } from "./lib.mjs";
import fs from "node:fs";

const dir = `${OUT}/store`;
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
};

const browser = await launch();
const { page } = await newClient(browser);
const issues = watch(page, "store");
try {
  // ---------- guest PDP + add to cart
  await page.goto(`${WEB}/p/cotton-tee-classic`, { waitUntil: "networkidle2" });
  await sleep(800);
  let t = await text(page);
  check("PDP guest shows public price ฿290", t.includes("฿290"));
  check("PDP guest qty-break table labelled for members", t.includes("ราคาส่งตามจำนวน (สำหรับสมาชิก)"), "");
  await clickText(page, "ใส่ตะกร้า", "button");
  await sleep(1500);
  const guestCart = await pageApi(page, "GET", "/cart");
  check("guest add to cart", guestCart.data?.items?.length === 1, JSON.stringify(guestCart.data?.items?.map((i) => [i.variant_id, i.qty])));

  // ---------- login → merge
  await uiLogin(page, "customer", "/cart");
  const merged = await pageApi(page, "GET", "/cart");
  check("cart merged after login", merged.data?.items?.some((i) => i.variant_id === guestCart.data.items[0].variant_id), JSON.stringify(merged.data?.items?.map((i) => [i.variant_id, i.qty])));

  // ---------- build a cart that triggers layers: qty-break tee x4 (gap hint), socks buy-2-get-1, spend ≥1500
  for (const it of merged.data.items) await pageApi(page, "DELETE", `/cart/items/${it.variant_id}`);
  await pageApi(page, "DELETE", "/cart/coupon");
  const find = async (q) => (await pageApi(page, "GET", `/products?q=${encodeURIComponent(q)}&per_page=5`)).data;
  const detail = async (slug) => (await pageApi(page, "GET", `/products/${slug}`)).data;
  const tee = await detail("cotton-tee-classic");
  const socksList = (await pageApi(page, "GET", "/products?category=fashion&per_page=48")).data;
  const all = (await pageApi(page, "GET", "/products?per_page=48&sort=price_desc")).data;
  // a buy-2-get-1 product (badge contains "ซื้อ 2")
  const bxgy = [...socksList, ...all].find((p) => p.badges.some((b) => b.includes("แถม")));
  const pricey = all.find((p) => p.min_price_satang >= 100000 && !p.flash && p.in_stock);
  const add = async (vid, qty) => pageApi(page, "POST", "/cart/items", { variant_id: vid, qty });
  await add(tee.variants.find((v) => v.in_stock).id, 4);
  if (bxgy) {
    const d = await detail(bxgy.slug);
    await add(d.variants.find((v) => v.in_stock).id, 3);
  }
  const pd = await detail(pricey.slug);
  await add(pd.variants.find((v) => v.in_stock).id, 1);
  await page.goto(`${WEB}/cart`, { waitUntil: "networkidle2" });
  await sleep(1500);
  t = await text(page);
  check("cart shows buy-2-get-1 layer", !bxgy || t.includes("แถม"), bxgy?.slug ?? "no bxgy product");
  check("cart shows spend-1500-get-150", t.includes("ครบ ฿1,500"));
  const gapBtn = await page.$$eval("button", (bs) => bs.map((b) => b.innerText).filter((s) => /^\+\s?\d/.test(s.trim()) || s.includes("เพิ่มอีก")));
  check("quantity_break_gap +N button", gapBtn.length > 0, JSON.stringify(gapBtn));
  if (gapBtn.length) {
    await clickText(page, gapBtn[0], "button");
    await sleep(1500);
    t = await text(page);
    check("+N applies trade tier label", t.includes("ราคาส่ง"), "");
  }
  await shot(page, "cart-layers", { dir, fullPage: true });

  // ---------- codes via the UI coupon box
  async function applyCode(code) {
    const hasInput = await page.$("#coupon");
    if (!hasInput) await clickText(page, "มีโค้ดส่วนลด", "button");
    await page.waitForSelector("#coupon");
    await page.click("#coupon", { clickCount: 3 });
    await page.type("#coupon", code);
    await clickText(page, "ใช้โค้ด", "button");
    await sleep(1800);
    const q = (await pageApi(page, "POST", "/cart/quote", {})).data;
    return { q, t: await text(page) };
  }
  async function clearCode() {
    await pageApi(page, "DELETE", "/cart/coupon");
    await page.reload({ waitUntil: "load" });
    await sleep(1000);
  }
  for (const [code, expectStatus] of [["NOPE999", "invalid"], ["SONGKRAN", "invalid"], ["WELCOME100", "applied"], ["FREESHIP11", "*"], ["1111SALE", "*"]]) {
    await clearCode();
    const { q, t: tt } = await applyCode(code);
    const c = q.coupon;
    const shown = c && tt.includes(c.message);
    const ok = c && (expectStatus === "*" || c.status === expectStatus) && shown;
    check(`code ${code}`, ok, `${c?.status}/${c?.reason_code}: ${c?.message} (shown=${shown})`);
    if (code === "SONGKRAN") await shot(page, "cart-expired-code", { dir });
  }
  await shot(page, "cart-1111sale", { dir, fullPage: true });

  // ---------- checkout (PromptPay)
  await page.goto(`${WEB}/checkout`, { waitUntil: "networkidle2" });
  await sleep(2000);
  t = await text(page);
  check("checkout shows address + shipping", t.includes("ที่อยู่") && /ค่าส่ง|จัดส่ง/.test(t));
  await shot(page, "checkout", { dir, fullPage: true });
  await clickText(page, "สั่งซื้อและชำระเงิน", "button");
  await page.waitForFunction(() => location.pathname.startsWith("/checkout/pay/"), { timeout: 20000 }).catch(() => {});
  check("order created → pay page", page.url().includes("/checkout/pay/"), page.url());
  await sleep(2500);
  const qr = await page.$("canvas, svg[aria-label*='QR'], img[alt*='QR']");
  check("PromptPay QR rendered", !!qr);
  await shot(page, "promptpay", { dir });
  await clickText(page, "จำลองจ่ายสำเร็จ", "button").catch((e) => check("mock pay button", false, e.message));
  await sleep(3000);
  t = await text(page);
  check("PromptPay → paid confirmation", /ชำระเงินสำเร็จ|ขอบคุณ/.test(t), t.slice(0, 120).replace(/\n/g, " "));
  await shot(page, "confirmation", { dir });
  const orderNo = decodeURIComponent(page.url().split("/checkout/pay/")[1].split("?")[0]);
  const ord = await pageApi(page, "GET", `/orders/${orderNo}`);
  check("order status paid", ord.data?.status === "paid", ord.data?.status);

  // ---------- account orders + timeline
  await page.goto(`${WEB}/account/orders/${orderNo}`, { waitUntil: "networkidle2" });
  await sleep(1500);
  t = await text(page);
  check("account order detail shows order", t.includes(orderNo));
  fs.writeFileSync(`${OUT}/last-order.txt`, orderNo);

  // ---------- card flows: success / 3DS approve / failure
  async function newOrder(method) {
    await add(tee.variants.find((v) => v.in_stock).id, 1);
    const addr = (await pageApi(page, "GET", "/me/addresses")).data[0];
    const q = (await pageApi(page, "POST", "/cart/quote", { address_id: addr.id })).data;
    const o = await pageApi(page, "POST", "/orders", { address_id: addr.id, payment_method: method, quote_hash: q.quote_hash }, { "Idempotency-Key": crypto.randomUUID() });
    return o.data?.order_no;
  }
  await pageApi(page, "DELETE", "/cart/coupon");
  for (const [num, expect] of [["4242424242424242", "success"], ["4000000000003220", "3ds"], ["4000000000000002", "fail"]]) {
    const no = await newOrder("card");
    if (!no) { check(`card ${expect} order`, false); continue; }
    await page.goto(`${WEB}/checkout/pay/${no}?method=card`, { waitUntil: "networkidle2" });
    await sleep(1500);
    const inputs = await page.$$("form input");
    // number, name, exp, cvc in DOM order (find by autocomplete)
    const fill = async (sel, v) => { const el = await page.$(sel); if (el) { await el.click({ clickCount: 3 }); await el.type(v); } return !!el; };
    const okNum = await fill('input[placeholder="4242 4242 4242 4242"]', num);
    await fill('input[placeholder="SOMCHAI JAIDEE"]', "TEST USER");
    await fill('input[placeholder="MM/YY"]', "12/30");
    await fill('input[placeholder="123"]', "123");
    if (!okNum) { check(`card form fields (${inputs.length} inputs)`, false); break; }
    await clickText(page, "ชำระ ฿", "button");
    await sleep(3000);
    if (expect === "3ds") {
      check("3DS redirected to mock authorize page", page.url().includes("/payments/mock/authorize/"), page.url());
      await shot(page, "card-3ds", { dir });
      await clickText(page, "อนุมัติ", "a").catch(() => {});
      await sleep(4000);
    }
    t = await text(page);
    const st = (await pageApi(page, "GET", `/orders/${no}`)).data?.status;
    if (expect === "fail") check("card failure shows Thai error, order still pending", st === "pending_payment" && /ไม่สำเร็จ|ปฏิเสธ/.test(t), `${st} ${t.slice(0, 200).replace(/\n/g, " ")}`);
    else check(`card ${expect} → paid`, st === "paid" && /ชำระเงินสำเร็จ|ขอบคุณ/.test(t), `${st} url=${page.url()}`);
  }
  check("no broken images on last page", (await brokenImages(page)).length === 0);
} catch (e) {
  check("script error", false, e.stack);
  await shot(page, "error", { dir });
}
fs.writeFileSync(`${OUT}/store-results.json`, JSON.stringify({ results, issues }, null, 2));
const bad = issues.filter((i) => !(i.kind === "http.401" && i.text.includes("/auth/me")));
console.log(`issues: ${bad.length}`);
for (const i of bad.slice(0, 30)) console.log(" ", i.kind, i.text.slice(0, 200), "@", i.url);
await browser.close();
