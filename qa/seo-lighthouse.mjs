// Wave 3 SEO: Lighthouse SEO category (mobile form factor, the default) on key pages; prints score + failed audits.
// usage: WEB=http://localhost:3105 LH_URLS=/,/p/camping-chair,/c/tshirts node seo-lighthouse.mjs
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import fs from "node:fs";
import { CHROME, WEB, OUT } from "./lib.mjs";

const urls = (process.env.LH_URLS ?? "/,/p/camping-chair,/c/tshirts").split(",");
const out = [];
for (const u of urls) {
  const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags: ["--headless=new", "--no-first-run"] });
  const r = await lighthouse(WEB + u, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["seo"] });
  await chrome.kill();
  const cat = r.lhr.categories.seo;
  const failed = cat.auditRefs
    .map((a) => r.lhr.audits[a.id])
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== "manual" && a.scoreDisplayMode !== "notApplicable")
    .map((a) => a.id);
  const row = { url: u, seo: Math.round(cat.score * 100), failed };
  out.push(row);
  console.log(JSON.stringify(row));
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/seo-lighthouse.json`, JSON.stringify(out, null, 2));
