import { launch, newClient, WEB, sleep } from "./lib.mjs";
import { adminLogin } from "./crawl-admin.mjs";
import fs from "node:fs";
const no = fs.readFileSync("out/screens-order.txt", "utf8").trim();
const b = await launch();
const { page } = await newClient(b, { width: 1024, height: 1366 });
await adminLogin(page, "staff");
await page.goto(`${WEB}/admin/packing/${no}`, { waitUntil: "load" });
await sleep(3000);
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => {
    const bs = [...document.querySelectorAll("button[aria-label^='หยิบ']")];
    const t = bs.find((x) => { const m = x.getAttribute("aria-label").match(/\((\d+)\/(\d+)\)$/); return m && m[1] !== m[2]; });
    t?.click();
  });
  await sleep(150);
}
await sleep(800);
await page.screenshot({ path: "D:/shop/docs/screenshots/real/admin-packing-1024.png" });
console.log(await page.evaluate(() => [...document.querySelectorAll("button[aria-label^='หยิบ']")].map((x) => x.getAttribute("aria-label")).join(" | ")));
await b.close();
