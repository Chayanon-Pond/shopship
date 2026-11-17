/**
 * schema.org builders for JSON-LD (pure; unit-tested in schema.test.ts).
 * PUBLIC data only: list prices and the public flash price. Member / trade / tier prices are personal and
 * fetched client-side — they must never reach structured data.
 */
import type { CategoryRef, FlashSale, Product, ProductCard, Review, StockLevel, Variant } from "../../lib/api/types.ts";
import { FREE_SHIPPING_MIN_SATANG, RETURNS, SHIPPING } from "./policy.ts";
import { clampText, stripMarkdown } from "./text.ts";

export type Ctx = { base: string; name: string; email?: string; freeShipMinSatang?: number | null };
type Node = Record<string, unknown>;

const S = "https://schema.org/";
const RASTER = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

export const abs = (base: string, u: string) => (/^https?:\/\//.test(u) ? u : `${base}${u.startsWith("/") ? "" : "/"}${u}`);
/** Satang → baht string with 2 decimals, integer math only ("29000" → "290.00"). */
export const baht = (satang: number) => {
  const s = Math.round(satang);
  return `${Math.trunc(s / 100)}.${String(Math.abs(s % 100)).padStart(2, "0")}`;
};
export const isRaster = (url: string) => RASTER.test(url);

const orgRef = (c: Ctx) => ({ "@type": "Organization", "@id": `${c.base}/#org`, name: c.name, url: c.base });
const freeShipMin = (c: Ctx) => (c.freeShipMinSatang === undefined ? FREE_SHIPPING_MIN_SATANG : c.freeShipMinSatang);

export function returnPolicy(c: Ctx): Node {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: SHIPPING.country,
    returnPolicyCountry: SHIPPING.country,
    returnPolicyCategory: `${S}MerchantReturnFiniteReturnWindow`,
    merchantReturnDays: RETURNS.days,
    returnMethod: `${S}ReturnByMail`,
    refundType: `${S}FullRefund`,
    // defective / wrong items: the shop pays return shipping. Change-of-mind return fees are not decided yet
    // (placeholder on /legal/returns) → deliberately not stated.
    itemDefectReturnFees: `${S}FreeReturn`,
    url: `${c.base}${RETURNS.path}`,
  };
}

const days = ([min, max]: readonly [number, number]) => ({ "@type": "QuantitativeValue", minValue: min, maxValue: max, unitCode: "DAY" });
const thailand = { "@type": "DefinedRegion", addressCountry: SHIPPING.country };

/** Only claimed when one unit already reaches the free-shipping threshold (the paid fee is weight-based and not public). */
export function freeShippingDetails(c: Ctx, priceSatang: number): Node | undefined {
  const min = freeShipMin(c);
  if (min == null || priceSatang < min) return undefined;
  return {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "THB" },
    shippingDestination: thailand,
    deliveryTime: { "@type": "ShippingDeliveryTime", handlingTime: days(SHIPPING.handlingDays), transitTime: days(SHIPPING.transitDays) },
  };
}

export function organization(c: Ctx): Node {
  const min = freeShipMin(c);
  return {
    "@type": "Organization",
    "@id": `${c.base}/#org`,
    name: c.name,
    url: c.base,
    logo: { "@type": "ImageObject", url: `${c.base}/icon.svg` },
    ...(c.email ? { email: c.email } : {}),
    hasMerchantReturnPolicy: returnPolicy(c),
    ...(min != null
      ? {
          hasShippingService: {
            "@type": "ShippingService",
            name: `${SHIPPING.carrier} ส่งฟรี`,
            shippingConditions: {
              "@type": "ShippingConditions",
              shippingDestination: thailand,
              orderValue: { "@type": "MonetaryAmount", minValue: Number(baht(min)), currency: "THB" },
              shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "THB" },
            },
          },
        }
      : {}),
  };
}

export function website(c: Ctx): Node {
  return {
    "@type": "WebSite",
    "@id": `${c.base}/#website`,
    name: c.name,
    url: `${c.base}/`,
    inLanguage: "th-TH",
    publisher: { "@id": `${c.base}/#org` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${c.base}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export type Crumb = { name: string; url: string };
export const categoryCrumbs = (crumbs: CategoryRef[]): Crumb[] => [{ name: "หน้าแรก", url: "/" }, ...crumbs.map((x) => ({ name: x.name, url: `/c/${x.slug}` }))];

export function breadcrumbs(c: Ctx, items: Crumb[]): Node {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: abs(c.base, it.url) })),
  };
}

/** Summary-page ItemList (url per entry; the details live on each product page). */
export function itemList(c: Ctx, name: string, products: Pick<ProductCard, "slug" | "name">[]): Node {
  return {
    "@type": "ItemList",
    name,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${c.base}/p/${p.slug}`, name: p.name })),
  };
}

const availability = (level: StockLevel, inStock: boolean) =>
  `${S}${!inStock || level === "out" ? "OutOfStock" : level === "low" ? "LimitedAvailability" : "InStock"}`;
const RANK: Record<string, number> = { [`${S}InStock`]: 2, [`${S}LimitedAvailability`]: 1, [`${S}OutOfStock`]: 0 };

/** The live public flash item of this product: inside its window, not sold out, variant still in stock. */
export function liveFlash(p: Product, flash: FlashSale | null, now: Date) {
  if (!flash) return null;
  const t = now.getTime();
  if (t < Date.parse(flash.starts_at) || t >= Date.parse(flash.ends_at)) return null;
  const it = flash.items.find((i) => i.product.id === p.id && i.remaining_qty > 0);
  const v = it && p.variants.find((x) => x.id === it.variant_id && x.in_stock);
  return it && v ? { variantId: v.id, priceSatang: it.sale_price_satang, endsAt: flash.ends_at } : null;
}

type Opts = { reviews: Review[]; flash: FlashSale | null; now: Date };

export function product(c: Ctx, p: Product, o: Opts): Node {
  const url = `${c.base}/p/${p.slug}`;
  const fl = liveFlash(p, o.flash, o.now);
  const offerOf = (v: Variant) => {
    const isFlash = fl?.variantId === v.id;
    const price = isFlash ? fl.priceSatang : v.price_satang;
    return {
      price,
      node: {
        "@type": "Offer",
        sku: v.sku,
        ...(p.variants.length > 1 ? { name: v.name } : {}),
        url,
        priceCurrency: "THB",
        price: baht(price),
        // ISO date in UTC: never later than the real (Bangkok) end
        ...(isFlash ? { priceValidUntil: fl.endsAt.slice(0, 10) } : {}),
        availability: isFlash ? `${S}LimitedAvailability` : availability(v.stock_level, v.in_stock),
        itemCondition: `${S}NewCondition`,
        seller: orgRef(c),
      } as Node,
    };
  };
  const offers = p.variants.map(offerOf);
  let offer: Node | undefined;
  if (offers.length === 1) {
    const ship = freeShippingDetails(c, offers[0].price);
    offer = { ...offers[0].node, ...(ship ? { shippingDetails: ship } : {}), hasMerchantReturnPolicy: returnPolicy(c) };
  } else if (offers.length > 1) {
    const prices = offers.map((x) => x.price);
    const low = Math.min(...prices);
    const best = offers.map((x) => x.node.availability as string).sort((a, b) => RANK[b] - RANK[a])[0];
    const ship = freeShippingDetails(c, low);
    offer = {
      "@type": "AggregateOffer",
      url,
      priceCurrency: "THB",
      lowPrice: baht(low),
      highPrice: baht(Math.max(...prices)),
      offerCount: offers.length,
      availability: best,
      itemCondition: `${S}NewCondition`,
      seller: orgRef(c),
      ...(ship ? { shippingDetails: ship } : {}),
      hasMerchantReturnPolicy: returnPolicy(c),
      offers: offers.map((x) => x.node),
    };
  }

  const desc = stripMarkdown(p.description || p.seo.description || p.subtitle || p.name);
  const images = [...new Set((p.images.length ? p.images : p.image ? [p.image] : []).map((i) => abs(c.base, i.url)))];
  const rs = p.reviews_summary;
  const reviews = o.reviews.filter((r) => r.rating >= 1 && r.rating <= 5 && r.author_name.trim()).slice(0, 5);

  return {
    "@type": "Product",
    "@id": `${url}#product`,
    name: p.name,
    ...(p.name_en ? { alternateName: p.name_en } : {}),
    description: clampText(desc, 5000),
    url,
    ...(images.length ? { image: images } : {}),
    ...(p.variants.length === 1 ? { sku: p.variants[0].sku } : {}),
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    ...(p.breadcrumbs.length ? { category: p.breadcrumbs.map((b) => b.name).join(" > ") } : {}),
    ...(offer ? { offers: offer } : {}),
    ...(rs.rating_count > 0 && rs.rating_avg > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(rs.rating_avg.toFixed(1)),
            reviewCount: rs.rating_count,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(reviews.length
      ? {
          review: reviews.map((r) => ({
            "@type": "Review",
            reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
            author: { "@type": "Person", name: r.author_name.trim() },
            datePublished: r.created_at.slice(0, 10),
            ...(r.title ? { name: r.title } : {}),
            ...(r.body ? { reviewBody: clampText(r.body, 1000) } : {}),
          })),
        }
      : {}),
  };
}
