// Admin catalog E2E: create a product with a size×colour variant matrix in the UI editor, upload an image (PNG) through
// the editor's file input, edit the price in the UI, inventory adjust via the UI dialog, hide/show a review, banners page,
// then check the storefront product page renders the uploaded photo via next/image.
import { launch, newClient, watch, WEB, OUT, sleep, pageApi, text, shot, clickText } from "./lib.mjs";
import { adminLogin } from "./crawl-admin.mjs";
import fs from "node:fs";
const dir = `${OUT}/catalog`;
fs.mkdirSync(dir, { recursive: true });
const check = (name, ok, info = "") => console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
const b = await launch();
const { page } = await newClient(b, { width: 1440, height: 1000 });
const issues = watch(page, "catalog");
const rnd = Math.random().toString(36).slice(2, 6);
// a real PNG to upload
const pngPath = `${dir}/upload.png`;
{
  const p2 = await b.newPage();
  await p2.setViewport({ width: 800, height: 800 });
  await p2.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:linear-gradient(135deg,#ffe8cc,#d0ebff);font:bold 90px sans-serif">QA ${rnd}</body>`);
  await p2.screenshot({ path: pngPath });
  await p2.close();
}
try {
  await adminLogin(page, "admin");
  await page.goto(`${WEB}/admin/products/new`, { waitUntil: "load" });
  await sleep(2500);
  await page.type("#name", `เสื้อทดสอบ QA ${rnd}`);
  await page.type("#name_en", `${rnd} QA Tee`);
  const optInputs = await page.$$('input[placeholder="พิมพ์แล้วกด Enter"]');
  for (const v of ["S", "M"]) { await optInputs[0].type(v); await optInputs[0].press("Enter"); }
  await optInputs[1].type("ดำ");
  await optInputs[1].press("Enter");
  await sleep(500);
  // bulk price
  await page.evaluate(() => {
    const lab = [...document.querySelectorAll("label, span, p")].find((l) => l.textContent.trim() === "ใช้ราคาเดียวกันทุกแถว");
    let box = lab.parentElement;
    while (box && !box.querySelector("input")) box = box.parentElement;
    box.querySelector("input").setAttribute("data-qa", "bulk");
  });
  await page.type('[data-qa="bulk"]', "390");
  await clickText(page, "ใช้กับทุกแถว", "button");
  for (const el of await page.$$('input[aria-label="สต็อกเริ่มต้น"]')) { await el.click({ clickCount: 3 }); await el.type("20"); }
  for (const el of await page.$$('input[aria-label="น้ำหนัก"]')) { await el.click({ clickCount: 3 }); await el.type("200"); }
  const catVal = await page.$eval("#cat", (s) => [...s.options].find((o) => o.textContent.includes("เสื้อยืด"))?.value);
  await page.select("#cat", catVal);
  // status → active if there is a status control
  await clickText(page, "เปิดขาย", "button, [role=radio]").catch(() => {});
  await shot(page, "product-new", { fullPage: true });
  await clickText(page, "สร้างสินค้า", "button");
  await page.waitForFunction(() => /\/admin\/products\/\d+$/.test(location.pathname), { timeout: 15000 });
  await sleep(2500);
  const id = Number(page.url().split("/").pop());
  let prod = (await pageApi(page, "GET", `/admin/products/${id}`)).data;
  check("product created via UI with 2 variants", prod?.variants?.length === 2, `id=${id} variants=${prod?.variants?.map((v) => v.sku + ":" + v.price_satang + ":" + v.stock).join(",")} status=${prod?.status}`);
  // upload image through the editor's file input
  const file = await page.$('input[type=file]');
  await file.uploadFile(pngPath);
  await sleep(4000);
  prod = (await pageApi(page, "GET", `/admin/products/${id}`)).data;
  check("image uploaded via editor", prod.images?.length === 1, prod.images?.[0]?.url);
  // edit price in the UI: first variant price → 420
  const priceInputs = await page.$$('input[aria-label="ราคา"]');
  await priceInputs[0].focus();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await priceInputs[0].type("420");
  await clickText(page, "บันทึก", "button");
  await sleep(3000);
  prod = (await pageApi(page, "GET", `/admin/products/${id}`)).data;
  check("price edited via UI", prod.variants.some((v) => v.price_satang === 42000), prod.variants.map((v) => v.price_satang).join(","));
  const hist = await pageApi(page, "GET", `/admin/variants/${prod.variants.find((v) => v.price_satang === 42000).id}/price-history`);
  check("price change logged in price_history", (hist.data ?? []).length >= 2, JSON.stringify(hist.data));
  if (prod.status !== "active") await pageApi(page, "PATCH", `/admin/products/${id}`, { status: "active" });
  await shot(page, "product-edit", { fullPage: true });

  // storefront page shows the uploaded photo (optimised by next/image from the media origin)
  await page.goto(`${WEB}/p/${prod.slug}`, { waitUntil: "networkidle2" });
  await sleep(1500);
  const img = await page.evaluate(() => { const i = [...document.images].find((x) => x.currentSrc.includes("/_next/image") || x.currentSrc.includes("/media/")); return i ? { src: i.currentSrc.slice(0, 160), w: i.naturalWidth } : null; });
  check("storefront PDP renders the uploaded image", img && img.w > 0, JSON.stringify(img));
  await shot(page, "pdp-new-product");

  // inventory adjust via the UI dialog
  await page.goto(`${WEB}/admin/inventory?q=${encodeURIComponent(rnd)}`, { waitUntil: "load" });
  await sleep(2500);
  const sku = prod.variants[0].sku;
  const before = prod.variants[0].stock;
  const ok = await page.evaluate((sku) => {
    const row = [...document.querySelectorAll("tr")].find((r) => r.innerText.includes(sku));
    const bt = row && [...row.querySelectorAll("button")].find((x) => x.innerText.includes("ปรับ"));
    bt?.click();
    return !!bt;
  }, sku);
  if (ok) {
    await sleep(800);
    const dlgInput = await page.$('[role=dialog] input, dialog input');
    await dlgInput.type("5");
    const reasonInput = (await page.$$('[role=dialog] input, [role=dialog] textarea, dialog input, dialog textarea'))[1];
    if (reasonInput) await reasonInput.type("QA รับเข้า");
    await clickText(page, "บันทึก", "[role=dialog] button, dialog button").catch(async () => clickText(page, "ยืนยัน", "[role=dialog] button, dialog button"));
    await sleep(2000);
  }
  const after = (await pageApi(page, "GET", `/admin/products/${id}`)).data.variants.find((v) => v.sku === sku).stock;
  check("inventory adjust via UI (+5)", after === before + 5, `${before} -> ${after} (row found: ${ok})`);
  await shot(page, "inventory");

  // reviews: hide then show the first review
  await page.goto(`${WEB}/admin/reviews`, { waitUntil: "load" });
  await sleep(2500);
  const first = (await pageApi(page, "GET", "/admin/reviews?page=1")).data[0];
  await page.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.innerText.trim() === "ซ่อน")?.click());
  await sleep(800);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("[role=dialog] button, dialog button")].filter((b) => b.innerText.trim() === "ซ่อน");
    btns[btns.length - 1]?.click();
  });
  await sleep(2000);
  const hidden = (await pageApi(page, "GET", "/admin/reviews?status=hidden")).data ?? [];
  check("review hidden via UI", hidden.length >= 1, `${hidden.length} hidden`);
  if (hidden[0]) await pageApi(page, "PATCH", `/admin/reviews/${hidden[0].id}`, { status: "published" });
  check("first review id seen", !!first);

  // banners page renders the seeded banners
  await page.goto(`${WEB}/admin/banners`, { waitUntil: "load" });
  await sleep(2500);
  check("banners page lists banners", (await text(page)).includes("11.11"));
  await shot(page, "banners", { fullPage: true });
} catch (e) {
  check("script error", false, e.stack);
  await shot(page, "error", { fullPage: true });
}
const bad = issues.filter((i) => !(i.kind.includes("401") && i.text.includes("/auth/me")));
console.log("issues:", bad.length);
for (const i of bad.slice(0, 20)) console.log(" ", i.kind, i.text.slice(0, 200), "@", i.url.replace(WEB, ""));
await b.close();
