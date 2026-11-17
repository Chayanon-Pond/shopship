// Ad-hoc probe: node probe.mjs <path> <js-expression> [width]
import { launch, watch, WEB, sleep, scrollThrough } from "./lib.mjs";
const [, , p, expr, w = "1440"] = process.argv;
const b = await launch();
const page = await b.newPage();
await page.setViewport({ width: Number(w), height: 900 });
const issues = watch(page);
await page.goto(WEB + encodeURI(p), { waitUntil: "networkidle2" });
await sleep(1000);
await scrollThrough(page);
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
if (process.env.ISSUES) console.log(issues);
await b.close();
