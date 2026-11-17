// Wave 3: zoomed shot of one element (e.g. the hero headline) at 390 px, 3x DPR.
import { launch, WEB } from "./lib.mjs";
const [path, selector, out] = process.argv.slice(2);
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.setCookie({ name: "shopship_consent", value: "v1.a0.m0.1794895200", url: WEB });
await page.goto(WEB + path, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 1200));
const el = await page.$(selector);
await el.screenshot({ path: out });
await browser.close();
