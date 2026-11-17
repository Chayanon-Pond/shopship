// Wave 3: who registers intervals / repeating timeouts / rAF loops on a page (stack chunk names).
import { launch, WEB } from "./lib.mjs";
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 823, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => {
  const log = (window.__timers = {});
  const rec = (kind, ms) => {
    const st = (new Error().stack || "").split("\n").slice(2, 6).map((l) => l.trim().replace(/^at /, "").replace(/https?:\/\/[^/]+\/_next\/static\/chunks\//, "")).join(" < ");
    const k = `${kind}(${ms ?? ""}) ${st}`;
    log[k] = (log[k] || 0) + 1;
  };
  const si = window.setInterval, st = window.setTimeout, raf = window.requestAnimationFrame;
  window.setInterval = function (f, ms, ...a) { rec("interval", ms); return si.call(this, f, ms, ...a); };
  window.setTimeout = function (f, ms, ...a) { rec("timeout", ms); return st.call(this, f, ms, ...a); };
  window.requestAnimationFrame = function (f) { rec("raf"); return raf.call(this, f); };
});
await page.goto(WEB + (process.argv[2] ?? "/"), { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 5000));
const t = await page.evaluate(() => window.__timers);
for (const [k, v] of Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(v).padStart(5), k.slice(0, 300));
await browser.close();
