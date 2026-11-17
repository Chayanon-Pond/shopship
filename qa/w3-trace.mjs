// Wave 3: main-thread trace of a page load (mobile, 4x CPU) -> time per top-level event name.
// usage: WEB=http://localhost:3103 node w3-trace.mjs /path
import fs from "node:fs";
import { launch, WEB, OUT } from "./lib.mjs";

const path = process.argv[2] ?? "/";
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const file = `${OUT}/trace.json`;
await page.tracing.start({ path: file, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing"] });
await page.goto(WEB + path, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 6000));
await page.tracing.stop();
await browser.close();
const { traceEvents } = JSON.parse(fs.readFileSync(file, "utf8"));
const main = traceEvents.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain" && traceEvents.some((x) => x.pid === e.pid && x.name === "ParseHTML"));
const ev = traceEvents.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === "X" && e.dur);
const agg = new Map();
for (const e of ev) {
  const k = e.name;
  const a = agg.get(k) ?? { n: 0, ms: 0 };
  a.n++;
  a.ms += e.dur / 1000;
  agg.set(k, a);
}
for (const [k, v] of [...agg].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25)) console.log(v.ms.toFixed(0).padStart(7), String(v.n).padStart(6), k);
const tasks = ev.filter((e) => e.name === "RunTask" && e.dur > 50000);
console.log("long tasks >50ms:", tasks.length, "sum", (tasks.reduce((s, e) => s + e.dur, 0) / 1000).toFixed(0), "ms");
// animation frames: who scheduled
const fi = ev.filter((e) => e.name === "FireAnimationFrame").length;
console.log("FireAnimationFrame:", fi);
// steady state: busy ms per second bucket since navigation start
const nav = ev.find((e) => e.name === "ParseHTML")?.ts ?? ev[0].ts;
const buckets = {};
for (const e of ev.filter((e) => e.name === "RunTask")) {
  const b = Math.floor((e.ts - nav) / 1e6);
  buckets[b] = (buckets[b] ?? 0) + e.dur / 1000;
}
console.log("busy ms per second:", Object.entries(buckets).map(([k, v]) => `${k}s:${v.toFixed(0)}`).join(" "));
const late = ev.filter((e) => e.ts - nav > 3e6 && e.name === "FunctionCall");
const lm = new Map();
for (const e of late) { const k = (e.args?.data?.url || "").split("/").pop() + " " + (e.args?.data?.functionName || ""); lm.set(k, (lm.get(k) ?? 0) + e.dur / 1000); }
console.log("late FunctionCall:", [...lm].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${v.toFixed(0)} ${k}`).join(" | "));
