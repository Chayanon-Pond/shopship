// Admin console crawl per role: login via UI, list visible nav, visit every console page, collect issues + shots.
import { launch, newClient, watch, WEB, OUT, USERS, sleep, shot, text, hScroll } from "./lib.mjs";
import fs from "node:fs";
const dir = `${OUT}/admin`;
fs.mkdirSync(dir, { recursive: true });
const PAGES = (process.env.APAGES ?? "/admin,/admin/orders,/admin/packing,/admin/customers,/admin/products,/admin/products/new,/admin/categories,/admin/inventory,/admin/promotions,/admin/promotions?tab=campaigns,/admin/promotions?tab=trade,/admin/promotions?tab=auto,/admin/promotions?tab=flash,/admin/promotions?tab=simulator,/admin/customer-groups,/admin/banners,/admin/reviews,/admin/staff,/admin/audit,/admin/settings").split(",");
const roles = (process.env.ROLES ?? "owner,admin,staff").split(",");
const width = Number(process.env.W ?? 1440);

export async function adminLogin(page, who) {
  const [email, password] = USERS[who];
  await page.goto(`${WEB}/admin/login`, { waitUntil: "networkidle2" });
  await page.waitForSelector("input[type=email]");
  await page.type("input[type=email]", email);
  await page.type("input[type=password]", password);
  await page.click("form button[type=submit]");
  await page.waitForFunction(() => location.pathname === "/admin" || location.pathname.startsWith("/admin/") && !location.pathname.startsWith("/admin/login"), { timeout: 15000 });
  await sleep(1500);
}

if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const b = await launch();
  const out = {};
  for (const role of roles) {
    const { page, ctx } = await newClient(b, { width, height: 900 });
    const issues = watch(page, role);
    await adminLogin(page, role);
    const nav = await page.$$eval("nav a[href^='/admin']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
    out[role] = { nav, pages: {} };
    console.log(role, "nav:", nav.join(" "));
    for (const p of PAGES) {
      await page.goto(WEB + p, { waitUntil: "load" });
      await sleep(2500);
      const t = await text(page);
      const forbidden = /ไม่มีสิทธิ์|403/.test(t);
      const hs = await hScroll(page);
      out[role].pages[p] = { forbidden, hs };
      await shot(page, `${role}${p.replace(/[^a-z0-9]+/gi, "_")}_${width}`, { dir, fullPage: true });
    }
    out[role].issues = issues;
    const bad = issues.filter((i) => !(i.text.includes("/auth/me") && i.kind.includes("401")));
    console.log(role, "issues:", bad.length);
    for (const i of bad.slice(0, 25)) console.log("  ", i.kind, i.text.slice(0, 160), "@", i.url.replace(WEB, ""));
    console.log(role, "forbidden pages:", Object.entries(out[role].pages).filter(([, v]) => v.forbidden).map(([k]) => k).join(" "));
    console.log(role, "hscroll:", Object.entries(out[role].pages).filter(([, v]) => v.hs).map(([k, v]) => k + JSON.stringify(v.hs)).join(" "));
    await ctx.close();
  }
  fs.writeFileSync(`${OUT}/admin-crawl.json`, JSON.stringify(out, null, 2));
  await b.close();
}
