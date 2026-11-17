// Shared QA helpers: launch local Chrome headless via puppeteer-core, capture console/network/image problems.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

export const WEB = process.env.WEB ?? "http://localhost:3000";
export const API = process.env.API ?? "http://localhost:8090";
export const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const OUT = process.env.OUT ?? "D:/shop/qa/out";
fs.mkdirSync(OUT, { recursive: true });

export const USERS = {
  owner: ["owner@shopship.local", "Demo-Owner-2026"],
  admin: ["admin@shopship.local", "Demo-Admin-2026"],
  staff: ["staff@shopship.local", "Demo-Staff-2026"],
  customer: ["customer@shopship.local", "Demo-Customer-2026"],
  wholesale: ["wholesale@shopship.local", "Demo-Wholesale-2026"],
  gold: ["gold@shopship.local", "Demo-Gold-2026"],
};

export async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check", "--lang=th-TH"],
    defaultViewport: { width: 1440, height: 900 },
  });
}

/** Attach problem collectors to a page. Returns the issues array (mutated). */
export function watch(page, label = "") {
  const issues = [];
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error" || t === "warning" || t === "warn") {
      const text = m.text();
      issues.push({ kind: `console.${t}`, label, url: page.url(), text: text.slice(0, 400) });
    }
  });
  page.on("pageerror", (e) => issues.push({ kind: "pageerror", label, url: page.url(), text: String(e).slice(0, 400) }));
  page.on("response", (r) => {
    const s = r.status();
    if (s >= 400) issues.push({ kind: `http.${s}`, label, url: page.url(), text: `${r.request().method()} ${r.url()}` });
  });
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (f.includes("ERR_ABORTED")) return; // navigations / RSC prefetch aborts
    issues.push({ kind: "requestfailed", label, url: page.url(), text: `${r.url()} ${f}` });
  });
  return issues;
}

export async function brokenImages(page) {
  return page.evaluate(() =>
    [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc)
      .map((i) => i.currentSrc),
  );
}

export async function hScroll(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const over = d.scrollWidth - d.clientWidth;
    if (over <= 0) return null;
    const vw = d.clientWidth;
    const culprits = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > vw + 1 && r.width > 0 && getComputedStyle(el).position !== "fixed";
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`);
    return { over, culprits };
  });
}

export async function shot(page, name, opts = {}) {
  const file = path.join(opts.dir ?? OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scroll through the page so lazy images / reveal-on-scroll content renders, then back to top. */
export async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.6;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 350));
    }
    window.scrollTo(0, 0);
  });
  await sleep(400);
}

/** Login through the API proxy using the page's own fetch (sets first-party cookies), returns Me. */
export async function apiLogin(page, who) {
  const [email, password] = USERS[who];
  return page.evaluate(
    async (email, password) => {
      const r = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    email,
    password,
  );
}

/** Click the first element whose visible text includes `text` (optionally restricted by selector). */
export async function clickText(page, text, selector = "button, a, [role=button], [role=tab], label") {
  const ok = await page.evaluate(
    (text, selector) => {
      const els = [...document.querySelectorAll(selector)].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (e.innerText || e.getAttribute("aria-label") || "").includes(text);
      });
      if (!els.length) return false;
      els[0].scrollIntoView({ block: "center" });
      els[0].click();
      return true;
    },
    text,
    selector,
  );
  if (!ok) throw new Error(`clickText: no element with text "${text}"`);
}

export async function text(page) {
  return page.evaluate(() => document.body.innerText);
}

export function report(name, data) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
}

let ipSeq = 10;
/** New isolated browser context that looks like a distinct client IP (x-real-ip → CLIENT_IP_HEADER). */
export async function newClient(browser, { width = 1440, height = 900, mobile = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setExtraHTTPHeaders({ "x-real-ip": `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}` });
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
  return { ctx, page };
}

/** Same-origin API call from inside the page (cookies + CSRF from /auth/me). */
export async function pageApi(page, method, path, body, headers = {}) {
  return page.evaluate(
    async (method, path, body, headers) => {
      const me = await fetch("/api/v1/auth/me?optional=true", { credentials: "include" }).then((r) => r.json()).catch(() => null);
      const h = { Accept: "application/json", ...headers };
      if (body !== undefined) h["Content-Type"] = "application/json";
      if (me?.data?.csrf_token && method !== "GET") h["X-CSRF-Token"] = me.data.csrf_token;
      const r = await fetch("/api/v1" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), credentials: "include" });
      const t = await r.text();
      let j = null;
      try { j = JSON.parse(t); } catch { j = t; }
      return { status: r.status, body: j, data: j?.data };
    },
    method, path, body, headers,
  );
}

export async function uiLogin(page, who, next = "/") {
  const [email, password] = USERS[who];
  await page.goto(`${WEB}/login?next=${encodeURIComponent(next)}`, { waitUntil: "networkidle2" });
  await page.waitForSelector('input[type=email]');
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', password);
  await Promise.all([page.waitForFunction((n) => location.pathname === n, { timeout: 15000 }, next.split("?")[0]), page.click('form button[type=submit]')]);
  await sleep(800);
}

export async function waitText(page, s, timeout = 15000) {
  await page.waitForFunction((s) => document.body.innerText.includes(s), { timeout }, s);
}
