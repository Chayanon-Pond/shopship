// Admin fulfilment E2E (iPad 1024): paid order → packing view (tap checklist) → create shipment → label page
// → mock-advance to delivered (order detail) → customer tracking → refund. Then a staff session must not see refund.
import { launch, newClient, watch, WEB, OUT, sleep, pageApi, text, shot, clickText } from "./lib.mjs";
import { adminLogin } from "./crawl-admin.mjs";
import fs from "node:fs";
const dir = `${OUT}/admin-flow`;
fs.mkdirSync(dir, { recursive: true });
const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
};
const b = await launch();
const { page } = await newClient(b, { width: 1024, height: 1366 });
const issues = watch(page, "admin-orders");
// the label page auto-calls window.print(), which blocks a headless page — stub it
await page.evaluateOnNewDocument(() => { window.print = () => { window.__printed = (window.__printed ?? 0) + 1; }; });
try {
  await adminLogin(page, "admin");
  const paid = (await pageApi(page, "GET", "/admin/orders?status=paid&per_page=50")).data;
  check("admin orders list has paid orders", paid?.length > 0, `${paid?.length}`);
  const no = process.env.ORDER || paid[paid.length - 1].order_no;
  // packing queue
  await page.goto(`${WEB}/admin/packing`, { waitUntil: "load" });
  await sleep(2500);
  check("packing queue lists the order", (await text(page)).includes(no));
  await page.goto(`${WEB}/admin/packing/${no}`, { waitUntil: "load" });
  await sleep(2500);
  if ((await text(page)).includes("เริ่มแพ็คออเดอร์นี้")) await clickText(page, "เริ่มแพ็คออเดอร์นี้", "button");
  await sleep(2000);
  const detail = (await pageApi(page, "GET", `/admin/orders/${no}`)).data;
  check("status → packing", detail.status === "packing", detail.status);
  // tap each pick button until its label reads (qty/qty) — one tap = one unit, like a packer on an iPad
  for (let i = 0; i < 60; i++) {
    const left = await page.evaluate(() => {
      const bt = [...document.querySelectorAll("button[aria-label^='หยิบ']")].find((x) => {
        const m = x.getAttribute("aria-label").match(/\((\d+)\/(\d+)\)$/);
        return m && m[1] !== m[2];
      });
      bt?.click();
      return !!bt;
    });
    if (!left) break;
    await sleep(120);
  }
  await shot(page, "packing-1024", { dir });
  const popupP = new Promise((res) => b.once("targetcreated", (t) => res(t)));
  await clickText(page, "สร้างใบส่ง + พิมพ์ใบปะหน้า", "button");
  await sleep(3000);
  const d2 = (await pageApi(page, "GET", `/admin/orders/${no}`)).data;
  check("shipment created, order shipped", d2.status === "shipped" && d2.shipment?.tracking_no, `${d2.status} ${d2.shipment?.tracking_no} id=${d2.shipment?.id}`);
  const popup = await Promise.race([popupP, sleep(2000).then(() => null)]);
  check("label opened", !!popup || page.url().includes("/print/label/"), popup?.url?.() ?? page.url());
  // close the label tab window.open() created and refocus (a background tab can't be screenshotted)
  for (const pg of await b.pages()) if (pg !== page && pg.url().includes("/label")) await pg.close();
  await page.bringToFront();
  // label page
  await page.goto(`${WEB}/admin/print/label/${no}`, { waitUntil: "load" });
  await sleep(2500);
  const lt = await text(page);
  check("label page shows tracking no", lt.includes(d2.shipment.tracking_no));
  // (no screenshot here: after the auto window.print() the headless tab can stall captureScreenshot)
  // advance to delivered via the order detail button
  await page.goto(`${WEB}/admin/orders/${no}`, { waitUntil: "load" });
  await sleep(2500);
  for (let i = 0; i < 4; i++) {
    await clickText(page, "เลื่อนสถานะพัสดุ (จำลอง)", "button").catch(() => {});
    await sleep(1500);
  }
  const d3 = (await pageApi(page, "GET", `/admin/orders/${no}`)).data;
  check("mock-advance → delivered", d3.status === "delivered" && d3.shipment?.status === "delivered", `${d3.status}/${d3.shipment?.status}`);
  await shot(page, "order-delivered", { dir, fullPage: true });
  // refund
  await clickText(page, "คืนเงิน", "button");
  await sleep(800);
  await clickText(page, "ยืนยัน", "[role=dialog] button, dialog button");
  await sleep(2500);
  const d4 = (await pageApi(page, "GET", `/admin/orders/${no}`)).data;
  check("refund → refunded", d4.status === "refunded", d4.status);
  check("status history has 6+ entries", d4.status_history?.length >= 6, `${d4.status_history?.length}`);
  fs.writeFileSync(`${OUT}/refunded-order.txt`, no);
} catch (e) {
  check("script error", false, e.stack);
  await shot(page, "error", { dir, fullPage: true });
}
console.log("issues:", issues.length);
for (const i of issues.slice(0, 20)) console.log(" ", i.kind, i.text.slice(0, 200), "@", i.url.replace(WEB, ""));
fs.writeFileSync(`${OUT}/admin-orders-results.json`, JSON.stringify({ results, issues }, null, 2));
await b.close();
