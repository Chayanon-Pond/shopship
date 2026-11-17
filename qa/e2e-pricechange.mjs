// 409 price_changed: customer opens checkout (quote loaded), admin raises the price, customer clicks "place order"
// → dialog with old vs new total → confirm → order created at the NEW price. Price restored afterwards.
import { launch, newClient, watch, WEB, OUT, sleep, pageApi, text, shot, clickText, uiLogin, USERS } from "./lib.mjs";
import { Client } from "./api.mjs";
import fs from "node:fs";
const dir = `${OUT}/store`;
const check = (name, ok, info = "") => console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
const b = await launch();
const { page } = await newClient(b);
const issues = watch(page, "pricechange");
const admin = new Client();
await admin.login(...USERS.admin);
try {
  await uiLogin(page, "customer", "/cart");
  for (const it of (await pageApi(page, "GET", "/cart")).data.items) await pageApi(page, "DELETE", `/cart/items/${it.variant_id}`);
  await pageApi(page, "DELETE", "/cart/coupon");
  const p = (await pageApi(page, "GET", "/products/oversize-tee-graphic")).data;
  const v = p.variants.find((x) => x.in_stock);
  await pageApi(page, "POST", "/cart/items", { variant_id: v.id, qty: 1 });
  await page.goto(`${WEB}/checkout`, { waitUntil: "load" });
  await sleep(3000);
  const before = v.price_satang;
  const up = await admin.patch(`/admin/variants/${v.id}`, { price_satang: before + 5000 });
  check("admin raised price", up.status === 200, `${before} -> ${before + 5000}`);
  await clickText(page, "สั่งซื้อและชำระเงิน", "button");
  await sleep(2500);
  const t = await text(page);
  check("price_changed dialog shown", t.includes("ยอดชำระใหม่") && t.includes("เพิ่มขึ้น"), "");
  await shot(page, "price-changed", { dir });
  await clickText(page, "ยืนยันและสั่งซื้อ", "button");
  await page.waitForFunction(() => location.pathname.startsWith("/checkout/pay/"), { timeout: 20000 }).catch(() => {});
  const no = decodeURIComponent(page.url().split("/checkout/pay/")[1]?.split("?")[0] ?? "");
  const o = no ? (await pageApi(page, "GET", `/orders/${no}`)).data : null;
  check("order created at the new price after confirm", o && o.items[0].unit_price_satang === before + 5000, `${no} unit=${o?.items?.[0]?.unit_price_satang}`);
  if (no) await pageApi(page, "POST", `/orders/${no}/cancel`);
  await admin.patch(`/admin/variants/${v.id}`, { price_satang: before });
} catch (e) {
  check("script error", false, e.stack);
  await shot(page, "error-pc", { dir });
}
console.log("issues:", issues.filter((i) => !i.text.includes("/auth/me")).map((i) => i.kind + " " + i.text).join("\n"));
await b.close();
