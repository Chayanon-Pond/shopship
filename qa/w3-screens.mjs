// Wave 3 screenshots: flash-sale shelf at 390/768/1440 (+ scrolled state via the paddle), cookie banner + settings.
// usage: WEB=http://localhost:3103 node w3-screens.mjs
import fs from "node:fs";
import { launch, WEB } from "./lib.mjs";

const DIR = "D:/shop/docs/screenshots/wave3";
fs.mkdirSync(DIR, { recursive: true });
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];

async function open(w, h, { consent = true, mobile = false } = {}) {
  const ctx = await browser.createBrowserContext(); // fresh cookies per shot
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  if (consent) await page.setCookie({ name: "shopship_consent", value: "v1.a0.m0.1794895200", url: WEB });
  await page.goto(WEB + "/", { waitUntil: "load" });
  return page;
}

for (const [w, h, mobile] of [[390, 844, true], [768, 1024, true], [1440, 900, false]]) {
  const page = await open(w, h, { mobile });
  // html has scroll-behavior:smooth; jump instantly so the shot is not taken mid-scroll
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const y = document.getElementById("flash-title").getBoundingClientRect().top + window.scrollY - (window.innerWidth < 1024 ? 130 : 160);
    window.scrollTo(0, y);
  });
  await sleep(1500);
  const info = await page.evaluate(() => {
    const ul = document.querySelector(".shelf");
    const first = ul?.querySelector("li")?.getBoundingClientRect();
    const head = document.getElementById("flash-title")?.getBoundingClientRect();
    const btns = [...document.querySelectorAll('[aria-roledescription="ชั้นวางสินค้า"] > div button')].map((b) => ({ disabled: b.disabled, visible: b.offsetParent !== null }));
    return {
      items: ul?.children.length,
      scrollWidth: ul?.scrollWidth,
      clientWidth: ul?.clientWidth,
      firstCardLeft: first && Math.round(first.left),
      headingLeft: head && Math.round(head.left),
      paddles: btns,
      pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  report.push({ w, ...info });
  await page.screenshot({ path: `${DIR}/flash-shelf-${w}.png` });
  if (w >= 768) {
    await page.click('[aria-roledescription="ชั้นวางสินค้า"] > div button:last-child');
    await sleep(1200);
    const after = await page.evaluate(() => {
      const ul = document.querySelector(".shelf");
      const btns = [...document.querySelectorAll('[aria-roledescription="ชั้นวางสินค้า"] > div button')].map((b) => b.disabled);
      return { scrollLeft: Math.round(ul.scrollLeft), disabled: btns };
    });
    report.push({ w, afterNext: after });
    await page.screenshot({ path: `${DIR}/flash-shelf-${w}-scrolled.png` });
  } else {
    // touch swipe on the phone
    await page.evaluate(() => document.querySelector(".shelf").scrollBy({ left: 400, behavior: "instant" }));
    await sleep(600);
    report.push({ w, afterSwipe: await page.evaluate(() => Math.round(document.querySelector(".shelf").scrollLeft)) });
    await page.screenshot({ path: `${DIR}/flash-shelf-${w}-scrolled.png` });
  }
  await page.close();
}

// cookie banner (first visit) + settings sheet
for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  const page = await open(w, h, { consent: false, mobile });
  await sleep(1500);
  report.push({ w, banner: await page.evaluate(() => !!document.querySelector('section[aria-label="การใช้คุกกี้"]')) });
  await page.screenshot({ path: `${DIR}/cookie-banner-${w}.png` });
  const [btn] = await page.$$("xpath/.//button[normalize-space()='ตั้งค่า']");
  await btn.click();
  await sleep(900);
  await page.screenshot({ path: `${DIR}/cookie-settings-${w}.png` });
  // toggle analytics, save, check cookie
  await page.click("#consent-analytics");
  const [save] = await page.$$("xpath/.//button[normalize-space()='บันทึกการตั้งค่า']");
  await save.click();
  await sleep(600);
  const ck = (await page.cookies()).find((c) => c.name === "shopship_consent");
  report.push({ w, savedCookie: ck?.value, expiresInDays: ck ? Math.round((ck.expires * 1000 - Date.now()) / 86400000) : null, bannerAfter: await page.evaluate(() => !!document.querySelector('section[aria-label="การใช้คุกกี้"]')) });
  await page.close();
}

// overflow sweep 320..1440 on home with the banner showing
for (const w of [320, 375, 390, 768, 1024, 1280, 1440]) {
  const page = await open(w, 900, { consent: false, mobile: w < 768 });
  await sleep(800);
  report.push({ sweep: w, overflowX: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) });
  await page.close();
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
