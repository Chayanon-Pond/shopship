// Lighthouse (mobile + desktop) on home, a product and a category page against the `next start` build.
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import fs from "node:fs";
import { CHROME, WEB, OUT } from "./lib.mjs";

const urls = (process.env.LH_URLS ?? "/,/p/cotton-tee-classic,/c/fashion").split(",");
const forms = (process.env.LH_FORMS ?? "mobile,desktop").split(",");
const dir = `${OUT}/lighthouse`;
fs.mkdirSync(dir, { recursive: true });
const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags: ["--headless=new", "--no-first-run"] });
const rows = [];
for (const form of forms) {
  for (const u of urls) {
    const config = form === "desktop" ? (await import("lighthouse/core/config/desktop-config.js")).default : undefined;
    const r = await lighthouse(WEB + u, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"] }, config);
    const c = r.lhr.categories;
    const score = (k) => Math.round((c[k]?.score ?? 0) * 100);
    const row = { form, url: u, perf: score("performance"), a11y: score("accessibility"), bp: score("best-practices"), seo: score("seo"),
      lcp: r.lhr.audits["largest-contentful-paint"].displayValue, tbt: r.lhr.audits["total-blocking-time"].displayValue, cls: r.lhr.audits["cumulative-layout-shift"].displayValue };
    rows.push(row);
    console.log(JSON.stringify(row));
    const failing = Object.values(r.lhr.audits).filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== "informative" && a.scoreDisplayMode !== "notApplicable" && a.scoreDisplayMode !== "manual");
    fs.writeFileSync(`${dir}/${form}${u.replace(/[^a-z0-9]+/gi, "_")}.lhr.json`, JSON.stringify(r.lhr));
    fs.writeFileSync(`${dir}/${form}${u.replace(/[^a-z0-9]+/gi, "_")}.txt`, failing.map((a) => `${a.id} ${a.score} ${a.displayValue ?? ""} :: ${a.title}`).join("\n"));
  }
}
fs.writeFileSync(`${OUT}/lighthouse.json`, JSON.stringify(rows, null, 2));
await chrome.kill();
