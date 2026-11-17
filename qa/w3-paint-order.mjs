// Wave 3: unthrottled page-load timeline (what Lighthouse's lantern sees as "observed"): when do scripts evaluate
// relative to first paint / LCP? Prints the main-thread events in order with ms since navigation.
// usage: WEB=http://localhost:3103 node w3-paint-order.mjs /path
import fs from "node:fs";
import { launch, WEB, OUT } from "./lib.mjs";

const path = process.argv[2] ?? "/";
const browser = await launch();
const page = await browser.newPage();
if (process.env.NOJS) await page.setJavaScriptEnabled(false);
await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true });
const file = `${OUT}/trace-order.json`;
await page.tracing.start({ path: file, categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "loading", "blink.user_timing"] });
await page.goto(WEB + path, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 2500));
await page.tracing.stop();
await browser.close();
const { traceEvents } = JSON.parse(fs.readFileSync(file, "utf8"));
const nav = traceEvents.find((e) => e.name === "navigationStart" && e.args?.data?.isLoadingMainFrame)?.ts ?? traceEvents.find((e) => e.name === "ParseHTML").ts;
const pick = traceEvents
  .filter((e) => ["ParseHTML", "EvaluateScript", "firstContentfulPaint", "largestContentfulPaint::Candidate", "Paint", "FunctionCall", "ResourceFinish"].includes(e.name))
  .filter((e) => e.name !== "FunctionCall" || (e.dur ?? 0) > 5000)
  .filter((e) => e.name !== "Paint" || true)
  .sort((a, b) => a.ts - b.ts);
let paints = 0;
for (const e of pick) {
  const t = ((e.ts - nav) / 1000).toFixed(0).padStart(5);
  const d = e.dur ? ` ${(e.dur / 1000).toFixed(1)}ms` : "";
  let x = "";
  if (e.name === "EvaluateScript") x = (e.args?.data?.url ?? "").split("/").pop();
  if (e.name === "FunctionCall") x = (e.args?.data?.url ?? "").split("/").pop();
  if (e.name === "largestContentfulPaint::Candidate") x = `${e.args?.data?.type} size=${e.args?.data?.size}`;
  if (e.name === "ResourceFinish") continue;
  if (e.name === "Paint" && ++paints > 6) continue;
  if (Number(t) > 2000) break;
  console.log(t, e.name + d, x);
}
