// Public page crawl at 4 widths: console/network/image/h-scroll issues + screenshots to qa/out/crawl.
import { launch, watch, brokenImages, hScroll, shot, scrollThrough, report, sleep, WEB, OUT } from "./lib.mjs";
import fs from "node:fs";

const pages = (process.env.PAGES ?? "/,/c/fashion,/c/bags,/search?q=เสื้อยึด,/p/cotton-tee-classic,/p/camping-chair,/flash-sale,/promotions,/campaign/11-11,/categories,/cart,/login,/register,/checkout,/account,/p/nope-404")
  .split(",");
const widths = (process.env.WIDTHS ?? "1440,1024,768,375").split(",").map(Number);
const dir = `${OUT}/crawl`;
fs.mkdirSync(dir, { recursive: true });

const browser = await launch();
const all = [];
for (const w of widths) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: w < 768 ? 812 : 900, isMobile: w < 768, hasTouch: w < 768 });
  const issues = watch(page, `w${w}`);
  for (const p of pages) {
    const res = await page.goto(WEB + encodeURI(p), { waitUntil: "networkidle2", timeout: 60000 }).catch((e) => ({ err: e }));
    const status = res?.status?.() ?? String(res?.err);
    await sleep(800);
    await scrollThrough(page);
    const broken = await brokenImages(page);
    const hs = await hScroll(page);
    const name = `${p.replace(/[^a-z0-9]+/gi, "_") || "home"}_${w}`;
    await shot(page, name, { dir, fullPage: true });
    all.push({ w, p, status, broken, hs });
    if (broken.length || hs || (typeof status === "number" && status >= 400)) console.log(w, p, status, broken.slice(0, 3), hs);
  }
  all.push(...issues.map((i) => ({ issue: i })));
  await ctx.close();
}
await browser.close();
report("crawl", all);
const iss = all.filter((x) => x.issue).map((x) => x.issue);
const uniq = new Map();
for (const i of iss) {
  const k = i.kind + " " + i.text.replace(/\d{3,}/g, "N").slice(0, 200);
  if (!uniq.has(k)) uniq.set(k, { ...i, n: 0 });
  uniq.get(k).n++;
}
for (const [, v] of uniq) console.log(`[${v.kind}] x${v.n} @${v.label} ${v.url}\n   ${v.text}`);
