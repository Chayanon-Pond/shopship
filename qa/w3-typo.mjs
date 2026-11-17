// Wave 3: top-of-page screenshots for typography comparison. usage: node w3-typo.mjs <label>
import fs from "node:fs";
import { launch, WEB } from "./lib.mjs";
const label = process.argv[2] ?? "x";
const DIR = `D:/shop/qa/out-w3/typo-${label}`;
fs.mkdirSync(DIR, { recursive: true });
const browser = await launch();
for (const [w, h] of [[390, 844], [1440, 900]]) for (const u of ["/", "/p/cotton-tee-classic"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setCookie({ name: "shopship_consent", value: "v1.a0.m0.1794895200", url: WEB });
  await page.goto(WEB + u, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1500));
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.weight}`).join(", "));
  console.log(w, u, fonts);
  await page.screenshot({ path: `${DIR}/${w}${u.replace(/\W+/g, "_")}.png` });
  await page.close();
}
await browser.close();
