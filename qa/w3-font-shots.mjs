// Wave 3 font swap: top-of-page shots (home, product) at 390/768/1440 + which platform font actually renders
// Thai text, Latin text and the countdown digits (CDP CSS.getPlatformFontsForNode).
// usage: WEB=http://localhost:3103 node w3-font-shots.mjs <label>
import fs from "node:fs";
import { launch, WEB } from "./lib.mjs";

const label = process.argv[2] ?? "x";
const DIR = `D:/shop/docs/screenshots/wave3/font/${label}`;
fs.mkdirSync(DIR, { recursive: true });
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fontsOf(page, cdp, selector) {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) return "(not found)";
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  return fonts.map((f) => `${f.familyName}${f.isCustomFont ? " (web)" : ""} x${f.glyphCount}`).join(", ");
}

for (const u of ["/", "/p/cotton-tee-classic"]) {
  for (const [w, h, mobile] of [[390, 844, true], [768, 1024, true], [1440, 900, false]]) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await page.setCookie({ name: "shopship_consent", value: "v1.a0.m0.1794895200", url: WEB });
    await page.goto(WEB + u, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await sleep(1500);
    const name = `${u === "/" ? "home" : "product"}-${w}`;
    await page.screenshot({ path: `${DIR}/${name}-top.png` });
    if (w === 390) {
      const cdp = await page.createCDPSession();
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      await page.evaluate(() => {
        const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
        const all = [...document.querySelectorAll("body *")];
        all.find((el) => /^฿[\d,.]+$/.test(own(el)))?.setAttribute("data-probe", "price");
        all.find((el) => el.closest('[role="timer"]') && /^\d$/.test(own(el)))?.setAttribute("data-probe", "digit");
      });
      const rows = {
        h1: await fontsOf(page, cdp, "h1"),
        thaiLink: await fontsOf(page, cdp, 'nav[aria-label="หมวดหมู่"] a:nth-child(3)'),
        price: await fontsOf(page, cdp, '[data-probe="price"]'),
        countdownDigit: await fontsOf(page, cdp, '[data-probe="digit"]'),
      };
      // digit width check: all tabular digits must have the same advance
      const widths = await page.evaluate(() => {
        const s = document.createElement("span");
        s.style.cssText = "position:absolute;visibility:hidden;font-variant-numeric:tabular-nums;font-weight:600;font-size:20px";
        document.body.appendChild(s);
        const out = {};
        for (const d of "0123456789") {
          s.textContent = d;
          out[d] = s.getBoundingClientRect().width.toFixed(2);
        }
        s.remove();
        return out;
      });
      console.log(label, u, JSON.stringify(rows), "digit widths", JSON.stringify(widths));
    }
    await ctx.close();
  }
}
await browser.close();
console.log("saved to", DIR);
