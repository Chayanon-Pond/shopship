// Wave 3: count React commits + re-rendered fibers per commit after load (devtools hook shim, prod build).
// usage: WEB=http://localhost:3103 node w3-commits.mjs /path
import { launch, WEB } from "./lib.mjs";

const path = process.argv[2] ?? "/";
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument(() => {
  const log = (window.__commits = []);
  const t0 = performance.now();
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
      let n = 0;
      const names = {};
      const walk = (f) => {
        while (f) {
          // profiling build (next build --profile): actualStartTime is set on fibers rendered in this commit
          if (typeof f.type === "function" && f.actualStartTime >= (window.__lastCommit || 0)) {
            n++;
            const nm = f.type.displayName || f.type.name || "?";
            names[nm] = (names[nm] || 0) + 1;
          }
          if (f.child) walk(f.child);
          f = f.sibling;
        }
      };
      walk(root.current.child);
      window.__lastCommit = performance.now();
      log.push({ t: Math.round(performance.now() - t0), n, names });
    },
  };
});
await page.goto(WEB + path, { waitUntil: "load" });
await new Promise((r) => setTimeout(r, 5000));
const commits = await page.evaluate(() => window.__commits);
console.log("commits:", commits.length);
for (const c of commits) console.log(c.t, c.n, JSON.stringify(Object.entries(c.names).sort((a, b) => b[1] - a[1]).slice(0, 8)));
await browser.close();
