// Wave 3 SEO validator. Loads key storefront pages from a production build, extracts + JSON.parses every
// application/ld+json block from the SERVER HTML (proves it is server-rendered), validates it against the
// schema.org / Google rich-result rules we rely on, cross-checks prices / ratings against the PUBLIC API,
// checks head metadata, robots.txt, sitemaps, real 404s, and DOM semantics (one h1, alts, link text) in Chrome.
// No external submissions.
// usage: WEB=http://localhost:3105 API=http://localhost:8099 node seo-validate.mjs
import fs from "node:fs";
import { launch, OUT, WEB, API } from "./lib.mjs";

const results = [];
let failures = 0;
let warnings = 0;
const rec = (page, check, ok, detail = "", level = "fail") => {
  const status = ok ? "pass" : level;
  if (!ok && level === "fail") failures++;
  if (!ok && level === "warn") warnings++;
  results.push({ page, check, status, detail: String(detail).slice(0, 300) });
};

const S = "https://schema.org/";
const AVAIL = new Set(["InStock", "OutOfStock", "LimitedAvailability", "PreOrder", "BackOrder", "Discontinued", "SoldOut", "OnlineOnly", "InStoreOnly"].map((x) => S + x));
const isAbs = (u) => typeof u === "string" && /^https?:\/\/[^/]+/.test(u);
const isPrice = (p) => typeof p === "string" ? /^\d+(\.\d{1,2})?$/.test(p) : Number.isFinite(p) && p >= 0;
const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && !Number.isNaN(Date.parse(d));
const api = async (p) => (await (await fetch(`${API}/api/v1${p}`)).json()).data;
const bahtStr = (satang) => (satang / 100).toFixed(2);

// ---------------------------------------------------------------- schema validators
function vReturnPolicy(page, rp, where) {
  rec(page, `${where} MerchantReturnPolicy`, rp?.["@type"] === "MerchantReturnPolicy", JSON.stringify(rp));
  if (!rp) return;
  rec(page, `${where} returnPolicy.applicableCountry`, rp.applicableCountry === "TH", rp.applicableCountry);
  rec(page, `${where} returnPolicy.category`, String(rp.returnPolicyCategory).startsWith(S + "MerchantReturn"), rp.returnPolicyCategory);
  if (rp.returnPolicyCategory === S + "MerchantReturnFiniteReturnWindow")
    rec(page, `${where} returnPolicy.merchantReturnDays`, Number.isInteger(rp.merchantReturnDays) && rp.merchantReturnDays > 0, rp.merchantReturnDays);
  rec(page, `${where} returnPolicy matches /legal/returns (7 days)`, rp.merchantReturnDays === 7, rp.merchantReturnDays);
}
function vShipping(page, sd, where) {
  const s = Array.isArray(sd) ? sd : [sd];
  for (const d of s) {
    rec(page, `${where} OfferShippingDetails`, d?.["@type"] === "OfferShippingDetails");
    rec(page, `${where} shippingRate`, d?.shippingRate?.currency === "THB" && Number.isFinite(d?.shippingRate?.value), JSON.stringify(d?.shippingRate));
    rec(page, `${where} shippingDestination TH`, d?.shippingDestination?.addressCountry === "TH");
    const dt = d?.deliveryTime;
    rec(page, `${where} deliveryTime handling+transit`, !!(dt?.handlingTime?.unitCode && dt?.transitTime?.unitCode), JSON.stringify(dt));
  }
}
function vOffer(page, o, where, ctx) {
  rec(page, `${where} @type Offer`, o["@type"] === "Offer", o["@type"]);
  rec(page, `${where} price`, isPrice(o.price), o.price);
  rec(page, `${where} priceCurrency THB`, o.priceCurrency === "THB", o.priceCurrency);
  rec(page, `${where} availability`, AVAIL.has(o.availability), o.availability);
  rec(page, `${where} url absolute`, isAbs(o.url), o.url);
  rec(page, `${where} itemCondition New`, o.itemCondition === S + "NewCondition", o.itemCondition);
  if (o.priceValidUntil) rec(page, `${where} priceValidUntil ISO date, not past`, isDate(o.priceValidUntil) && o.priceValidUntil >= new Date().toISOString().slice(0, 10), o.priceValidUntil);
  if (ctx) rec(page, `${where} price is a PUBLIC price (list or live flash)`, ctx.allowed.has(String(o.price)), `${o.price} not in {${[...ctx.allowed]}}`);
}
function vProduct(page, n, ctx) {
  rec(page, "Product.name", typeof n.name === "string" && n.name.length > 0, n.name);
  rec(page, "Product.image absolute", Array.isArray(n.image) ? n.image.length > 0 && n.image.every(isAbs) : isAbs(n.image), JSON.stringify(n.image));
  rec(page, "Product.description", typeof n.description === "string" && n.description.length > 0 && n.description.length <= 5000);
  rec(page, "Product.offers|review|aggregateRating present", !!(n.offers || n.review || n.aggregateRating));
  rec(page, "Product.url absolute", isAbs(n.url), n.url);
  rec(page, "Product.brand Brand", !n.brand || (n.brand["@type"] === "Brand" && n.brand.name), JSON.stringify(n.brand));
  const o = n.offers;
  if (o) {
    if (o["@type"] === "AggregateOffer") {
      rec(page, "AggregateOffer.lowPrice", isPrice(o.lowPrice), o.lowPrice);
      rec(page, "AggregateOffer.highPrice >= lowPrice", isPrice(o.highPrice) && Number(o.highPrice) >= Number(o.lowPrice), `${o.lowPrice}..${o.highPrice}`);
      rec(page, "AggregateOffer.priceCurrency THB", o.priceCurrency === "THB");
      rec(page, "AggregateOffer.offerCount", Number.isInteger(o.offerCount) && o.offerCount > 0 && o.offerCount === (o.offers?.length ?? o.offerCount), o.offerCount);
      rec(page, "AggregateOffer.availability", AVAIL.has(o.availability), o.availability);
      (o.offers ?? []).forEach((x, i) => vOffer(page, x, `offers[${i}]`, ctx));
      const prices = (o.offers ?? []).map((x) => Number(x.price));
      if (prices.length) rec(page, "AggregateOffer low/high = min/max of offers", Number(o.lowPrice) === Math.min(...prices) && Number(o.highPrice) === Math.max(...prices));
      if (o.hasMerchantReturnPolicy) vReturnPolicy(page, o.hasMerchantReturnPolicy, "AggregateOffer");
      if (o.shippingDetails) vShipping(page, o.shippingDetails, "AggregateOffer");
      if (ctx) rec(page, "multi-variant product uses AggregateOffer", ctx.variants > 1);
    } else {
      vOffer(page, o, "Offer", ctx);
      if (o.hasMerchantReturnPolicy) vReturnPolicy(page, o.hasMerchantReturnPolicy, "Offer");
      if (o.shippingDetails) vShipping(page, o.shippingDetails, "Offer");
      if (ctx) rec(page, "single-variant product uses Offer", ctx.variants === 1);
    }
    const rp = o.hasMerchantReturnPolicy;
    rec(page, "hasMerchantReturnPolicy present", !!rp, "", "warn");
    if (ctx) {
      const low = o["@type"] === "AggregateOffer" ? Number(o.lowPrice) : Number(o.price);
      const free = low * 100 >= ctx.freeShipMin;
      rec(page, `shippingDetails only when price ≥ free-ship threshold (${ctx.freeShipMin / 100})`, free === !!o.shippingDetails, `low=${low} shipping=${!!o.shippingDetails}`);
    }
  }
  if (n.aggregateRating) {
    const a = n.aggregateRating;
    rec(page, "AggregateRating.ratingValue 1..5", a.ratingValue >= 1 && a.ratingValue <= 5, a.ratingValue);
    rec(page, "AggregateRating.reviewCount > 0", (a.reviewCount ?? a.ratingCount) > 0, a.reviewCount);
  }
  if (ctx) {
    rec(page, "aggregateRating only when real ratings exist", !!n.aggregateRating === ctx.ratingCount > 0, `ld=${!!n.aggregateRating} api=${ctx.ratingCount}`);
    if (n.aggregateRating) rec(page, "aggregateRating matches API", n.aggregateRating.reviewCount === ctx.ratingCount && Math.abs(n.aggregateRating.ratingValue - ctx.ratingAvg) < 0.06, `${n.aggregateRating.ratingValue}/${n.aggregateRating.reviewCount} vs ${ctx.ratingAvg}/${ctx.ratingCount}`);
  }
  for (const [i, r] of (n.review ?? []).entries()) {
    rec(page, `review[${i}] author.name`, !!r.author?.name);
    rec(page, `review[${i}] reviewRating 1..5`, r.reviewRating?.ratingValue >= 1 && r.reviewRating?.ratingValue <= 5);
    rec(page, `review[${i}] datePublished`, isDate(r.datePublished), r.datePublished);
    if (ctx) rec(page, `review[${i}] is a real API review`, ctx.reviews.some((x) => x.author_name.trim() === r.author.name && x.rating === r.reviewRating.ratingValue));
  }
}
function vBreadcrumbs(page, n, canonical) {
  const el = n.itemListElement ?? [];
  rec(page, "BreadcrumbList ≥ 2 items", el.length >= 2, el.length);
  rec(page, "BreadcrumbList positions 1..n", el.every((x, i) => x.position === i + 1 && x["@type"] === "ListItem"));
  rec(page, "BreadcrumbList names + absolute items", el.every((x) => x.name && isAbs(x.item)));
  if (canonical) rec(page, "BreadcrumbList last item = canonical", el.at(-1)?.item === canonical, `${el.at(-1)?.item} vs ${canonical}`);
}
function vItemList(page, n) {
  const el = n.itemListElement ?? [];
  rec(page, "ItemList has items", el.length > 0, el.length);
  rec(page, "ItemList positions + absolute url", el.every((x, i) => x.position === i + 1 && isAbs(x.url)));
  rec(page, "ItemList.numberOfItems", n.numberOfItems === el.length);
  return el.map((x) => x.url);
}
function vOrg(page, n) {
  rec(page, "Organization name/url/logo", !!n.name && isAbs(n.url) && (isAbs(n.logo) || isAbs(n.logo?.url)));
  if (n.hasMerchantReturnPolicy) vReturnPolicy(page, n.hasMerchantReturnPolicy, "Organization");
  if (n.hasShippingService) {
    const c = n.hasShippingService.shippingConditions;
    rec(page, "ShippingService conditions (TH, orderValue, rate)", c?.shippingDestination?.addressCountry === "TH" && Number.isFinite(c?.orderValue?.minValue) && c?.shippingRate?.value === 0, JSON.stringify(c));
  }
}
function vWebsite(page, n) {
  rec(page, "WebSite url", isAbs(n.url));
  const t = n.potentialAction?.target;
  const tpl = typeof t === "string" ? t : t?.urlTemplate;
  rec(page, "SearchAction → /search?q={search_term_string}", n.potentialAction?.["@type"] === "SearchAction" && /\/search\?q=\{search_term_string\}$/.test(tpl ?? ""), tpl);
  rec(page, "SearchAction query-input", n.potentialAction?.["query-input"] === "required name=search_term_string");
}

// ---------------------------------------------------------------- html helpers
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1]?.replace(/&amp;/g, "&");
const meta = (html, key) => {
  const t = [...html.matchAll(/<meta [^>]*>/g)].map((m) => m[0]).find((m) => attr(m, "property") === key || attr(m, "name") === key);
  return t ? attr(t, "content") : undefined;
};
const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

async function checkHead(page, html, { noindex = false, path }) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const desc = meta(html, "description");
  const canonical = attr(html.match(/<link rel="canonical"[^>]*>/)?.[0] ?? "", "href");
  rec(page, "html lang=th", /<html[^>]* lang="th"/.test(html));
  rec(page, "meta theme-color", !!meta(html, "theme-color"));
  rec(page, "viewport", !!meta(html, "viewport"));
  rec(page, "title ≤ 60 chars", title.length > 0 && title.length <= 60, `${title.length}: ${title}`);
  rec(page, "title not split mid-word (no dangling Thai mark after …)", !/…$/.test(title) || !/[ัิ-ฺ็-๎]…/.test(title), title);
  const robots = meta(html, "robots") ?? "";
  if (noindex) {
    rec(page, "robots noindex", /noindex/.test(robots), robots);
    return { canonical };
  }
  rec(page, "not noindex", !/noindex/.test(robots), robots);
  rec(page, "description 50..155 chars", !!desc && desc.length >= 50 && desc.length <= 155, `${desc?.length}: ${desc}`, desc && desc.length < 50 ? "warn" : "fail");
  rec(page, "canonical absolute, no query", isAbs(canonical) && !canonical.includes("?"), canonical);
  if (path) rec(page, "canonical = clean path", canonical === `${WEB}${path === "/" ? "" : path}` || canonical === `${WEB}${path}`, `${canonical} vs ${path}`);
  for (const k of ["og:title", "og:description", "og:url", "og:image", "og:locale", "og:type", "og:site_name", "twitter:card", "twitter:title", "twitter:image"])
    rec(page, `${k} present`, !!meta(html, k), meta(html, k));
  rec(page, "og:locale th_TH", meta(html, "og:locale") === "th_TH");
  rec(page, "og:url = canonical", meta(html, "og:url") === canonical, `${meta(html, "og:url")} vs ${canonical}`);
  rec(page, "og:title matches <title>", meta(html, "og:title") === title, `${meta(html, "og:title")} vs ${title}`);
  const img = meta(html, "og:image");
  rec(page, "og:image absolute", isAbs(img), img);
  if (isAbs(img)) {
    const r = await fetch(img);
    const ct = r.headers.get("content-type") ?? "";
    rec(page, "og:image loads as raster image", r.ok && /^image\/(png|jpe?g|webp|gif)/.test(ct), `${r.status} ${ct}`);
  }
  return { canonical };
}

// ---------------------------------------------------------------- main
const fetchHtml = async (p) => {
  const r = await fetch(WEB + p, { redirect: "manual" });
  return { status: r.status, html: await r.text() };
};

const [cats, flash, campaign, first] = await Promise.all([api("/categories"), api("/flash-sales/current"), api("/campaigns/active"), fetch(`${API}/api/v1/products?per_page=48`).then((r) => r.json())]);
const allCards = [...first.data];
for (let pg = 2; pg <= first.meta.total_pages; pg++) allCards.push(...(await fetch(`${API}/api/v1/products?per_page=48&page=${pg}`).then((r) => r.json())).data);
const FREE_SHIP_MIN = Number(process.env.FREE_SHIP_MIN ?? 99000);

// sample products: flash, multi-variant, single-variant, with reviews, none, expensive (free shipping), out of stock
const details = await Promise.all(allCards.map((c) => api(`/products/${c.slug}`)));
const pick = (f) => details.find(f)?.slug;
const productSlugs = [
  ...new Set(
    [
      flash.current?.items[0]?.product.slug,
      pick((p) => p.variants.length > 1),
      pick((p) => p.variants.length === 1),
      pick((p) => p.reviews_summary.rating_count > 0),
      pick((p) => p.reviews_summary.rating_count === 0),
      pick((p) => p.min_price_satang >= FREE_SHIP_MIN && !p.flash),
      pick((p) => p.variants.some((v) => !v.in_stock)),
      pick((p) => p.variants.some((v) => v.stock_level === "low")),
    ].filter(Boolean),
  ),
];
const parent = cats[0];
const child = cats.find((c) => c.children.length)?.children[0];

const pages = [
  { path: "/", types: ["Organization", "WebSite"] },
  { path: `/c/${parent.slug}`, types: ["BreadcrumbList", "ItemList"] },
  ...(child ? [{ path: `/c/${child.slug}`, types: ["BreadcrumbList", "ItemList"] }] : []),
  ...productSlugs.map((s) => ({ path: `/p/${s}`, types: ["Product", "BreadcrumbList"], slug: s })),
  { path: "/flash-sale", types: flash.current ? ["BreadcrumbList", "ItemList"] : ["BreadcrumbList"] },
  ...(campaign ? [{ path: `/campaign/${campaign.slug}`, types: ["BreadcrumbList"] }] : []),
  { path: "/promotions", types: [] },
  { path: "/categories", types: [] },
  { path: "/legal/returns", types: [] },
  { path: "/legal/shipping", types: [] },
  { path: "/search?q=เสื้อ", types: [], noindex: true },
  { path: "/cart", types: [], noindex: true },
  { path: "/login", types: [], noindex: true },
];

const itemUrls = new Set();
const ldDump = {};
for (const pg of pages) {
  const { status, html } = await fetchHtml(pg.path);
  rec(pg.path, "HTTP 200", status === 200, status);
  const { canonical } = await checkHead(pg.path, html, { noindex: pg.noindex, path: pg.path });
  const blocks = ldBlocks(html);
  const nodes = [];
  for (const [i, b] of blocks.entries()) {
    let doc;
    try {
      doc = JSON.parse(b);
      rec(pg.path, `ld+json[${i}] parses`, true);
    } catch (e) {
      rec(pg.path, `ld+json[${i}] parses`, false, e.message);
      continue;
    }
    rec(pg.path, `ld+json[${i}] @context schema.org`, doc["@context"] === "https://schema.org", doc["@context"]);
    nodes.push(...(doc["@graph"] ?? [doc]));
  }
  ldDump[pg.path] = nodes;
  const types = nodes.map((n) => n["@type"]);
  for (const t of pg.types) rec(pg.path, `has ${t}`, types.includes(t), types.join(","));
  if (pg.noindex) rec(pg.path, "no rich-result markup on noindex page", !types.includes("Product"), types.join(","));

  let ctx;
  if (pg.slug) {
    const p = details.find((d) => d.slug === pg.slug);
    const reviews = (await fetch(`${API}/api/v1/products/${pg.slug}/reviews`).then((r) => r.json())).data;
    const now = Date.now();
    const live = flash.current && now >= Date.parse(flash.current.starts_at) && now < Date.parse(flash.current.ends_at)
      ? flash.current.items.filter((i) => i.product.id === p.id && i.remaining_qty > 0) : [];
    const allowed = new Set([...p.variants.map((v) => bahtStr(v.price_satang)), ...live.map((i) => bahtStr(i.sale_price_satang))]);
    ctx = { allowed, variants: p.variants.length, ratingCount: p.reviews_summary.rating_count, ratingAvg: p.reviews_summary.rating_avg, reviews, freeShipMin: FREE_SHIP_MIN };
    // the flash variant must be priced at the flash price, others at list
    const prod = nodes.find((n) => n["@type"] === "Product");
    if (prod && live.length) {
      const offers = prod.offers["@type"] === "AggregateOffer" ? prod.offers.offers : [prod.offers];
      const fv = p.variants.find((v) => v.id === live[0].variant_id);
      const o = offers.find((x) => x.sku === fv.sku);
      rec(pg.path, "live flash variant offered at flash price with priceValidUntil", o?.price === bahtStr(live[0].sale_price_satang) && !!o?.priceValidUntil, JSON.stringify(o));
    }
    if (prod) rec(pg.path, "Product name = API name", prod.name === p.name);
  }
  for (const n of nodes) {
    switch (n["@type"]) {
      case "Product": vProduct(pg.path, n, ctx); break;
      case "BreadcrumbList": vBreadcrumbs(pg.path, n, canonical); break;
      case "ItemList": vItemList(pg.path, n).forEach((u) => itemUrls.add(u)); break;
      case "Organization": vOrg(pg.path, n); break;
      case "WebSite": vWebsite(pg.path, n); break;
      default: rec(pg.path, `known @type ${n["@type"]}`, false, "unexpected type", "warn");
    }
  }
}

// ItemList / breadcrumb targets resolve
for (const u of itemUrls) {
  const r = await fetch(u, { method: "HEAD" });
  rec("ItemList targets", `${u.replace(WEB, "")} → 200`, r.status === 200, r.status);
}

// canonical of a tracking / sort / filter variant = clean URL
{
  const p = `/c/${parent.slug}?sort=price_asc&min_price=0&utm_source=line&fbclid=abc`;
  const { html } = await fetchHtml(p);
  const canonical = attr(html.match(/<link rel="canonical"[^>]*>/)?.[0] ?? "", "href");
  rec(p, "canonical strips sort/filter/tracking params", canonical === `${WEB}/c/${parent.slug}`, canonical);
  const pp = `/p/${productSlugs[0]}?utm_campaign=x&gclid=1`;
  const r2 = await fetchHtml(pp);
  rec(pp, "product canonical strips tracking params", attr(r2.html.match(/<link rel="canonical"[^>]*>/)?.[0] ?? "", "href") === `${WEB}/p/${productSlugs[0]}`);
}

// real 404s
for (const p of ["/p/no-such-product-xyz", "/c/no-such-category-xyz", "/campaign/no-such-campaign"]) {
  const { status, html } = await fetchHtml(p);
  rec(p, "real HTTP 404", status === 404, status);
  rec(p, "404 has noindex", /<meta name="robots" content="[^"]*noindex/.test(html));
}

// robots.txt
{
  const t = await (await fetch(`${WEB}/robots.txt`)).text();
  for (const d of ["/admin", "/account", "/checkout", "/cart", "/api/", "/search?"]) rec("/robots.txt", `Disallow: ${d}`, t.split("\n").some((l) => l.trim() === `Disallow: ${d}`));
  rec("/robots.txt", "Disallow sort variants", t.includes("Disallow: /*?sort="));
  rec("/robots.txt", "storefront allowed (Allow: /)", t.includes("Allow: /"));
  rec("/robots.txt", "Sitemap: absolute index", new RegExp(`Sitemap: ${WEB}/sitemap_index.xml`).test(t), t.match(/Sitemap:.*/g));
}

// sitemaps
{
  const idx = await (await fetch(`${WEB}/sitemap_index.xml`)).text();
  const files = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  rec("/sitemap_index.xml", "lists core + product sitemaps", files.some((f) => f.endsWith("/sitemap.xml")) && files.some((f) => f.includes("/sitemaps/products/sitemap/")), files.join(" "));
  const urls = [];
  for (const f of files) {
    const r = await fetch(f);
    const x = await r.text();
    rec("/sitemap_index.xml", `${f.replace(WEB, "")} loads (xml)`, r.ok && x.includes("<urlset"), r.status);
    urls.push(...[...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  }
  rec("sitemaps", "no duplicate URLs", new Set(urls).size === urls.length, `${urls.length} urls`);
  rec("sitemaps", "all URLs absolute on the site origin", urls.every((u) => u.startsWith(WEB)));
  const prodUrls = new Set(urls.filter((u) => u.includes("/p/")));
  rec("sitemaps", `every active product listed (${allCards.length})`, allCards.every((c) => prodUrls.has(`${WEB}/p/${c.slug}`)) && prodUrls.size === allCards.length, `${prodUrls.size} in sitemap`);
  const catSlugs = cats.flatMap((c) => [c.slug, ...c.children.map((x) => x.slug)]);
  rec("sitemaps", `every category listed (${catSlugs.length})`, catSlugs.every((s) => urls.includes(`${WEB}/c/${s}`)));
  rec("sitemaps", "legal pages listed", ["privacy", "cookies", "terms", "returns", "shipping"].every((s) => urls.includes(`${WEB}/legal/${s}`)));
  rec("sitemaps", "promotions + flash-sale listed", urls.includes(`${WEB}/promotions`) && urls.includes(`${WEB}/flash-sale`));
  if (campaign) rec("sitemaps", "active campaign listed", urls.includes(`${WEB}/campaign/${campaign.slug}`));
  rec("sitemaps", "no private/noindex URLs", !urls.some((u) => /\/(admin|account|cart|checkout|search|login|register)/.test(u)));
  // every sitemap URL answers 200 (8 at a time)
  const bad = [];
  for (let i = 0; i < urls.length; i += 8) {
    const rs = await Promise.all(urls.slice(i, i + 8).map((u) => fetch(u, { method: "HEAD" }).then((r) => [u, r.status])));
    bad.push(...rs.filter(([, s]) => s !== 200));
  }
  rec("sitemaps", `all ${urls.length} URLs return 200`, bad.length === 0, JSON.stringify(bad.slice(0, 5)));
}

// DOM semantics in Chrome (after hydration)
const browser = await launch();
for (const pg of pages.filter((p) => !p.noindex)) {
  const ctxB = await browser.createBrowserContext();
  const page = await ctxB.newPage();
  await page.goto(WEB + pg.path, { waitUntil: "networkidle2", timeout: 60000 });
  const d = await page.evaluate(() => {
    const visible = (el) => !el.closest("[aria-hidden=true]") && el.getClientRects().length > 0;
    const h1 = [...document.querySelectorAll("h1")];
    const imgs = [...document.querySelectorAll("main img")];
    const missingAlt = imgs.filter((i) => !i.hasAttribute("alt")).map((i) => i.src);
    // product / category photos with empty alt and no accessible name on the wrapping control
    const emptyAlt = imgs
      .filter((i) => i.getAttribute("alt") === "" && visible(i) && /\/media\/|\/demo\/|\/mock\//.test(i.currentSrc || i.src))
      .filter((i) => {
        const c = i.closest("a,button");
        return !c || !(c.getAttribute("aria-label") || c.textContent.trim());
      })
      .map((i) => i.currentSrc || i.src);
    const links = [...document.querySelectorAll("a[href]")].filter(visible);
    const noText = links.filter((a) => !(a.textContent.trim() || a.getAttribute("aria-label") || a.querySelector("img[alt]:not([alt=''])") || a.getAttribute("title"))).map((a) => a.getAttribute("href"));
    const generic = links.filter((a) => /^(click here|here|more|read more|คลิกที่นี่|ที่นี่|อ่านต่อ)$/i.test(a.textContent.trim())).map((a) => a.textContent.trim());
    const crumbs = !!document.querySelector('nav[aria-label="breadcrumb"] ol li a');
    return { h1: h1.length, h1Text: h1.map((x) => x.textContent.trim()).join(" | "), missingAlt, emptyAlt, noText, generic, crumbs };
  });
  rec(pg.path, "exactly one <h1>", d.h1 === 1, `${d.h1}: ${d.h1Text}`);
  rec(pg.path, "every <img> in main has alt", d.missingAlt.length === 0, d.missingAlt.join(" "));
  rec(pg.path, "product/category photos have descriptive alt", d.emptyAlt.length === 0, d.emptyAlt.join(" "), "warn");
  rec(pg.path, "links have an accessible name", d.noText.length === 0, d.noText.join(" "));
  rec(pg.path, "no generic link text", d.generic.length === 0, d.generic.join(" "), "warn");
  if (pg.slug || pg.path.startsWith("/c/")) rec(pg.path, "breadcrumb UI with links", d.crumbs);
  await ctxB.close();
}
await browser.close();

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/seo-validate.json`, JSON.stringify({ results, ld: ldDump }, null, 2));
const byPage = {};
for (const r of results) (byPage[r.page] ??= { pass: 0, fail: 0, warn: 0 })[r.status]++;
for (const [p, c] of Object.entries(byPage)) console.log(`${c.fail ? "FAIL" : "ok  "} ${p.padEnd(48)} pass=${c.pass} fail=${c.fail} warn=${c.warn}`);
for (const r of results.filter((x) => x.status !== "pass")) console.log(`  [${r.status}] ${r.page} :: ${r.check} :: ${r.detail}`);
console.log(`\n${results.length} checks, ${failures} failed, ${warnings} warnings. Products sampled: ${productSlugs.join(", ")}`);
process.exit(failures ? 1 : 0);
