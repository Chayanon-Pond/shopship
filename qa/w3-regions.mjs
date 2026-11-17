// Wave 3: React render cost by page region (needs `next build --profile`): treeBaseDuration of host elements
// (header / section / footer / nav / main lists) right after hydration, 4x CPU throttle.
import { launch, WEB } from "./lib.mjs";
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true });
const cdp = await page.createCDPSession();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.evaluateOnNewDocument(() => {
  window.__roots = [];
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject() {
      return 1;
    },
    onScheduleFiberRoot() {},
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    onCommitFiberRoot(_id, root) {
      window.__root = root;
      window.__commits = (window.__commits || 0) + 1;
    },
  };
});
await page.goto(WEB + (process.argv[2] ?? "/"), { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 4000));
const rows = await page.evaluate(() => {
  const out = [];
  const total = { self: 0, comps: 0 };
  const host = (f) => {
    let c = f.child;
    while (c && typeof c.type !== "string") c = c.child;
    if (!c) return "";
    const d = c.stateNode;
    return `${c.type}.${String(d?.className || "").slice(0, 40)} ${(d?.getAttribute?.("aria-label") || d?.id || "").slice(0, 30)}`;
  };
  const walk = (f, depth) => {
    while (f) {
      if (typeof f.type === "function" || (f.type && typeof f.type === "object")) {
        total.self += f.selfBaseDuration || 0;
        total.comps++;
        if ((f.selfBaseDuration || 0) > 0.8) out.push({ tag: f.type.displayName || f.type.name || "?", aria: host(f), cls: "", ms: +(f.treeBaseDuration || 0).toFixed(1), self: +(f.selfBaseDuration || 0).toFixed(2) });
      }
      if (f.child) walk(f.child, depth + 1);
      f = f.sibling;
    }
  };
  walk(window.__root.current, 0);
  return { total, commits: window.__commits, rows: out.sort((a, b) => b.self - a.self).slice(0, 40) };
});
console.log("commits", rows.commits, "components", rows.total.comps, "sum selfBaseDuration ms", rows.total.self.toFixed(1));
for (const r of rows.rows) console.log(String(r.ms).padStart(7), String(r.self).padStart(6), r.tag, "|", r.aria);
await browser.close();
