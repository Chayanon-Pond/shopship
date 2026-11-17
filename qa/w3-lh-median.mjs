// Wave 3: Lighthouse mobile, N runs per URL (fresh Chrome per run), median perf + metrics. The machine is shared
// with other builds, so single runs swing ±20 points; the median is what we report.
// usage: WEB=http://localhost:3103 RUNS=5 node w3-lh-median.mjs [label]
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import fs from "node:fs";
import { CHROME, WEB, OUT } from "./lib.mjs";

const urls = (process.env.LH_URLS ?? "/,/p/cotton-tee-classic,/c/fashion").split(",");
const runs = Number(process.env.RUNS ?? 5);
const label = process.argv[2] ?? "run";
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = [];
for (const u of urls) {
  const rs = [];
  for (let i = 0; i < runs; i++) {
    const chrome = await chromeLauncher.launch({ chromePath: CHROME, chromeFlags: ["--headless=new", "--no-first-run"] });
    const r = await lighthouse(WEB + u, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance"] });
    await chrome.kill();
    const a = r.lhr.audits;
    rs.push({
      perf: Math.round(r.lhr.categories.performance.score * 100),
      fcp: a["first-contentful-paint"].numericValue,
      lcp: a["largest-contentful-paint"].numericValue,
      tbt: a["total-blocking-time"].numericValue,
      cls: a["cumulative-layout-shift"].numericValue,
      si: a["speed-index"].numericValue,
      bench: r.lhr.environment.benchmarkIndex,
    });
  }
  const row = {
    label,
    url: u,
    perfMedian: med(rs.map((x) => x.perf)),
    perfAll: rs.map((x) => x.perf).join(","),
    fcp: Math.round(med(rs.map((x) => x.fcp))),
    lcp: Math.round(med(rs.map((x) => x.lcp))),
    tbt: Math.round(med(rs.map((x) => x.tbt))),
    cls: Number(med(rs.map((x) => x.cls)).toFixed(3)),
    si: Math.round(med(rs.map((x) => x.si))),
    bench: Math.round(med(rs.map((x) => x.bench))),
  };
  out.push(row);
  console.log(JSON.stringify(row));
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/lh-median-${label}.json`, JSON.stringify(out, null, 2));
