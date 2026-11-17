// Wave 3 perf: full-page regression screenshots of /, a product and a category page at 390/768/1440.
// Scrolls slowly first so every scroll-in reveal has fired. Consent pre-decided (banner shot separately).
// usage: WEB=http://localhost:3103 node w3-perf-shots.mjs <label>
import fs from "node:fs";
import { launch, WEB } from "./lib.mjs";

const label = process.argv[2] ?? "x";
const DIR = `D:/shop/docs/screenshots/wave3/perf/${label}`;
fs.mkdirSync(DIR, { recursive: true });
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const u of ["/", "/p/cotton-tee-classic", "/c/fashion"]) {
  for (const [w, h, mobile] of [[390, 844, true], [768, 1024, true], [1440, 900, false]]) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await page.setCookie({ name: "shopship_consent", value: "v1.a0.m0.1794895200", url: WEB });
    await page.goto(WEB + u, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // top-of-page shot first (hero / gallery / filters as the visitor lands)
    await sleep(1200);
    const name = `${u === "/" ? "home" : u.split("/")[1]}-${w}`;
    await page.screenshot({ path: `${DIR}/${name}-top.png` });
    await page.evaluate(async () => {
      document.documentElement.style.scrollBehavior = "auto";
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 250));
      }
      window.scrollTo(0, 0);
    });
    // real-scroll check (no override): a viewport shot half-way down the page, content-visibility sections rendered on demand
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await sleep(1200);
    await page.screenshot({ path: `${DIR}/${name}-mid.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    // full-page capture only: Chrome does not render content-visibility:auto sections for a fullPage screenshot
    await page.addStyleTag({ content: ".cv-section,.cv-tile{content-visibility:visible!important}" });
    await sleep(1500);
    await page.screenshot({ path: `${DIR}/${name}-full.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log("saved to", DIR);
