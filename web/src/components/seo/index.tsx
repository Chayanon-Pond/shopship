/**
 * Structured-data server components. Pages only drop one of these in; all schema logic lives in ./schema.ts.
 * Everything here renders on the server (no "use client"), so it adds zero client JS.
 */
import { cacheLife, cacheTag } from "next/cache";
import { flashSales, productOrNull, reviewsFirstPage } from "@/app/(site)/_lib/data";
import type { CategoryRef, FlashSale, ProductCard } from "@/lib/api/types";
import { site } from "@/lib/site";
import { JsonLd } from "./json-ld";
import * as schema from "./schema";

export { JsonLd } from "./json-ld";
export { categoryCrumbs, type Crumb } from "./schema";

const ctx: schema.Ctx = { base: site.url, name: site.name, email: site.email };

/** Home page: Organization (+ return / shipping policy) and WebSite with the search action. */
export function SiteJsonLd() {
  return <JsonLd data={[schema.organization(ctx), schema.website(ctx)]} />;
}

export function BreadcrumbJsonLd({ items }: { items: schema.Crumb[] }) {
  return <JsonLd data={schema.breadcrumbs(ctx, items)} />;
}

/** Listing pages (category, flash sale, campaign): BreadcrumbList + ItemList of the products shown first. */
export function ListingJsonLd({ name, crumbs, products }: { name: string; crumbs: schema.Crumb[]; products: Pick<ProductCard, "slug" | "name">[] }) {
  return <JsonLd data={[schema.breadcrumbs(ctx, crumbs), ...(products.length ? [schema.itemList(ctx, name, products)] : [])]} />;
}

export function flashListing(current: FlashSale | null) {
  const seen = new Set<string>();
  return (current?.items ?? []).map((i) => i.product).filter((p) => !seen.has(p.slug) && seen.add(p.slug));
}

/**
 * Product + BreadcrumbList. Cached like the page; the flash window is checked against the clock here
 * ('use cache' may read the time) and the offer carries priceValidUntil = flash end.
 */
async function productGraph(slug: string) {
  "use cache";
  cacheTag("products", `product:${slug}`, `reviews:${slug}`, "flash-sales");
  cacheLife("minutes");
  const p = await productOrNull(slug);
  if (!p) return null;
  const [reviews, flash] = await Promise.all([reviewsFirstPage(slug), flashSales()]);
  const crumbs = [...schema.categoryCrumbs(p.breadcrumbs as CategoryRef[]), { name: p.name, url: `/p/${p.slug}` }];
  return [schema.product(ctx, p, { reviews: reviews.data, flash: flash.current, now: new Date() }), schema.breadcrumbs(ctx, crumbs)];
}

export async function ProductJsonLd({ slug }: { slug: string }) {
  const graph = await productGraph(slug);
  return graph ? <JsonLd data={graph} /> : null;
}
