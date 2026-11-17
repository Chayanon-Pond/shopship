// Wave 3: paint / LCP entries (element + time) and when the HTML finished parsing, unthrottled.
// usage: WEB=http://localhost:3103 node w3-paints.mjs /path
import { launch, WEB } from "./lib.mjs";

const browser = await launch();
const page = await browser.newPage();
if (process.env.NOJS) await page.setJavaScriptEnabled(false);
await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true });
if (process.env.INJECT_CSS) {
  await page.evaluateOnNewDocument((css) => {
    const add = () => {
      const st = document.createElement("style");
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    };
    add();
  }, process.env.INJECT_CSS);
}
await page.evaluateOnNewDocument(() => {
  window.__lcp = [];
  const describe = (e) => {
    if (!e.element) return e.url;
    const cls = String(e.element.className).slice(0, 60);
    const text = (e.element.textContent || "").slice(0, 30);
    return `${e.element.tagName}.${cls} ${text}`;
  };
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__lcp.push({ t: Math.round(e.startTime), size: e.size, el: describe(e) });
  });
  po.observe({ type: "largest-contentful-paint", buffered: true });
  document.addEventListener("DOMContentLoaded", () => {
    window.__dcl = Math.round(performance.now());
  });
});
await page.goto(WEB + (process.argv[2] ?? "/"), { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 1500));
const out = await page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return {
    paint: performance.getEntriesByType("paint").map((p) => `${p.name}:${Math.round(p.startTime)}`),
    dcl: window.__dcl,
    lcp: window.__lcp,
    responseStart: Math.round(n.responseStart),
    responseEnd: Math.round(n.responseEnd),
    domInteractive: Math.round(n.domInteractive),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
