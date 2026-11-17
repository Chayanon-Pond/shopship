// Wave 3: JS CPU profile of a page load (mobile viewport, 4x CPU throttle) -> top self-time functions + React commit count.
// usage: WEB=http://localhost:3103 node w3-profile.mjs /path
import { launch, WEB } from "./lib.mjs";

const path = process.argv[2] ?? "/";
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.goto(WEB + path, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 6000));
const { profile } = await cdp.send("Profiler.stop");
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const cf = n.callFrame;
  const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
}
const byUrl = new Map();
for (const [k, v] of self) {
  const u = k.split(" ").pop().split(":")[0] || "(native)";
  byUrl.set(u, (byUrl.get(u) ?? 0) + v);
}
console.log("== self ms by script");
for (const [k, v] of [...byUrl].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(v.toFixed(0).padStart(7), k);
console.log("== top functions");
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(v.toFixed(0).padStart(7), k);
// inclusive time per function for samples later than LATE ms (steady state)
const LATE = Number(process.env.LATE ?? 2500) * 1000;
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const incl = new Map();
let t = profile.startTime;
for (let i = 0; i < profile.samples.length; i++) {
  t += dt[i] ?? 0;
  if (t - profile.startTime < LATE) continue;
  const seen = new Set();
  let id = profile.samples[i];
  while (id) {
    const cf = byId.get(id).callFrame;
    const key = `${cf.functionName || "(anon)"} ${cf.url.split("/").pop()}:${cf.lineNumber}:${cf.columnNumber}`;
    if (!seen.has(key)) { seen.add(key); incl.set(key, (incl.get(key) ?? 0) + (dt[i] ?? 0) / 1000); }
    id = parent.get(id);
  }
}
console.log("== late inclusive");
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 45)) console.log(v.toFixed(0).padStart(7), k);
await browser.close();
