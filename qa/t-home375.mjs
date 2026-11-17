import { launch, newClient, WEB, sleep, scrollThrough } from "./lib.mjs";
const b = await launch();
const { page } = await newClient(b, { width: 375, height: 812, mobile: true });
await page.goto(`${WEB}/`, { waitUntil: "networkidle2" });
await sleep(1500);
await page.screenshot({ path: "D:/shop/docs/screenshots/real/home-375.png" });
await scrollThrough(page);
await page.screenshot({ path: "D:/shop/docs/screenshots/real/home-375-full.png", fullPage: true });
await b.close();
