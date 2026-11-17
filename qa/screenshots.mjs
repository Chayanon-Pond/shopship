// Fresh screenshots of the REAL stack (Go API + embedded PG + `next start`) into docs/screenshots/real/.
import { launch, newClient, WEB, sleep, pageApi, uiLogin, clickText, scrollThrough, text } from "./lib.mjs";
import { adminLogin } from "./crawl-admin.mjs";
import fs from "node:fs";
const dir = "D:/shop/docs/screenshots/real";
fs.mkdirSync(dir, { recursive: true });
const snap = async (page, name, fullPage = false) => {
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage });
  console.log("saved", name);
};
const b = await launch();

// home desktop + 375
if (!process.env.ONLY_CART) {
  const { page, ctx } = await newClient(b, { width: 1440, height: 900 });
  await page.goto(`${WEB}/`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await snap(page, "home-1440");
  await scrollThrough(page);
  await snap(page, "home-1440-full", true);
  await ctx.close();
  const m = await newClient(b, { width: 375, height: 812, mobile: true });
  await m.page.goto(`${WEB}/`, { waitUntil: "networkidle2" });
  await sleep(1500);
  await snap(m.page, "home-375");
  await scrollThrough(m.page);
  await snap(m.page, "home-375-full", true);
  await m.ctx.close();
}

// product as the wholesale user (trade prices from /offers)
if (!process.env.ONLY_CART) {
  const { page, ctx } = await newClient(b, { width: 1440, height: 1000 });
  await uiLogin(page, "wholesale", "/p/cotton-tee-classic");
  await sleep(2500);
  await snap(page, "product-wholesale-1440");
  await ctx.close();
}

// customer: cart with layers + seasonal code → checkout → PromptPay → confirmation; then packing view
let orderNo = "";
{
  const { page, ctx } = await newClient(b, { width: 1440, height: 1100 });
  await uiLogin(page, "gold", "/cart");
  if (!(await pageApi(page, "GET", "/me/addresses")).data.length)
    await pageApi(page, "POST", "/me/addresses", { recipient_name: "สมศรี ทองคำ", phone: "0898765432", line1: "88/8 ถนนนิมมานเหมินท์", line2: "", subdistrict: "สุเทพ", district: "เมืองเชียงใหม่", province: "เชียงใหม่", postal_code: "50200", is_default: true });
  for (const it of (await pageApi(page, "GET", "/cart")).data.items) await pageApi(page, "DELETE", `/cart/items/${it.variant_id}`);
  await pageApi(page, "DELETE", "/cart/coupon");
  const first = async (slug) => (await pageApi(page, "GET", `/products/${slug}`)).data.variants.find((v) => v.in_stock).id;
  await pageApi(page, "POST", "/cart/items", { variant_id: await first("cotton-tee-classic"), qty: 5 });
  await pageApi(page, "POST", "/cart/items", { variant_id: await first("cashew-honey-roasted"), qty: 3 });
  await pageApi(page, "POST", "/cart/items", { variant_id: await first("canvas-tote-bag"), qty: 4 });
  await pageApi(page, "POST", "/cart/items", { variant_id: await first("camping-chair"), qty: 1 });
  await pageApi(page, "PUT", "/cart/coupon", { code: "1111SALE" });
  await page.goto(`${WEB}/cart`, { waitUntil: "load" });
  await sleep(3000);
  await snap(page, "cart-layers-1111sale-1440", true);
  await page.goto(`${WEB}/checkout`, { waitUntil: "load" });
  await sleep(3000);
  await clickText(page, "สั่งซื้อและชำระเงิน", "button");
  await page.waitForFunction(() => location.pathname.startsWith("/checkout/pay/"), { timeout: 20000 });
  await sleep(3500);
  orderNo = decodeURIComponent(page.url().split("/checkout/pay/")[1].split("?")[0]);
  await page.setViewport({ width: 1440, height: 1250 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await snap(page, "promptpay-1440", true);
  await clickText(page, "จำลองจ่ายสำเร็จ", "button");
  await sleep(3500);
  await snap(page, "order-confirmation-1440");
  await ctx.close();
}

// admin
{
  const { page, ctx } = await newClient(b, { width: 1440, height: 1000 });
  await adminLogin(page, "owner");
  await page.goto(`${WEB}/admin`, { waitUntil: "load" });
  await sleep(3000);
  await snap(page, "admin-dashboard-1440");
  for (const tab of ["campaigns", "trade"]) {
    await page.goto(`${WEB}/admin/promotions?tab=${tab}`, { waitUntil: "load" });
    await sleep(3000);
    await snap(page, `admin-promotions-${tab}-1440`, true);
  }
  await page.goto(`${WEB}/admin/promotions?tab=simulator`, { waitUntil: "load" });
  await sleep(2500);
  await clickText(page, "ขายส่ง 12 ชิ้น + ส่งฟรี", "button");
  await sleep(2500);
  await clickText(page, "คำนวณ", "button");
  await sleep(3000);
  await snap(page, "admin-simulator-1440", true);
  await page.setViewport({ width: 1024, height: 1366 });
  await page.goto(`${WEB}/admin/packing/${orderNo}`, { waitUntil: "load" });
  await sleep(2500);
  if ((await text(page)).includes("เริ่มแพ็คออเดอร์นี้")) {
    await clickText(page, "เริ่มแพ็คออเดอร์นี้", "button");
    await sleep(2500);
  }
  // pick the first line completely and one unit of the second, so the checklist shows progress
  await page.evaluate(() => {
    const bs = [...document.querySelectorAll("button[aria-label^='หยิบ']")];
    const m = bs[0]?.getAttribute("aria-label").match(/\((\d+)\/(\d+)\)$/);
    for (let i = 0; i < Number(m?.[2] ?? 0); i++) bs[0].click();
    bs[1]?.click();
  });
  await sleep(1000);
  await snap(page, "admin-packing-1024");
  await ctx.close();
}
fs.writeFileSync("out/screens-order.txt", orderNo);
await b.close();
