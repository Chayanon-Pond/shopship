// Mobile checks at 375: bottom tab bar visible + fixed, PDP sticky buy bar appears after scrolling past the buy box,
// no horizontal scroll on key pages at 375/768/1024/1440.
import { launch, newClient, WEB, OUT, sleep, hScroll, shot } from "./lib.mjs";
const check = (name, ok, info = "") => console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " — " + info : ""}`);
const b = await launch();
const { page } = await newClient(b, { width: 375, height: 812, mobile: true });
await page.goto(`${WEB}/`, { waitUntil: "networkidle2" });
await sleep(1000);
const tab = await page.evaluate(() => {
  const n = [...document.querySelectorAll("nav")].find((x) => getComputedStyle(x).position === "fixed" && x.getBoundingClientRect().bottom >= window.innerHeight - 2);
  return n ? { links: n.querySelectorAll("a").length, h: Math.round(n.getBoundingClientRect().height), text: n.innerText.replace(/\n/g, " ") } : null;
});
check("mobile bottom tab bar", tab && tab.links >= 4, JSON.stringify(tab));
await page.goto(`${WEB}/p/cotton-tee-classic`, { waitUntil: "networkidle2" });
await sleep(1000);
await page.evaluate(() => window.scrollTo(0, 2200));
await sleep(1200);
const bar = await page.evaluate(() => {
  const els = [...document.body.querySelectorAll("body > *, body > * > *")].filter((e) => getComputedStyle(e).position === "fixed" && e.innerText.includes("ใส่ตะกร้า"));
  return els.map((e) => ({ bottom: Math.round(e.getBoundingClientRect().bottom), h: Math.round(e.getBoundingClientRect().height), vis: getComputedStyle(e).visibility, op: getComputedStyle(e).opacity }));
});
check("PDP sticky buy bar after scroll", bar.length > 0, JSON.stringify(bar));
await shot(page, "mobile-pdp-sticky");
for (const w of [375, 768, 1024, 1440]) {
  await page.setViewport({ width: w, height: 900, isMobile: w < 768, hasTouch: w < 768 });
  for (const p of ["/", "/p/cotton-tee-classic", "/c/fashion", "/cart", "/checkout", "/search?q=bag", "/flash-sale", "/promotions"]) {
    await page.goto(WEB + p, { waitUntil: "load" });
    await sleep(700);
    const hs = await hScroll(page);
    if (hs) check(`no h-scroll ${w} ${p}`, false, JSON.stringify(hs));
  }
}
console.log("h-scroll sweep done");
await b.close();
