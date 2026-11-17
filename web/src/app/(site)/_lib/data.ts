/**
 * Cached PUBLIC data for storefront server components (Next 16 'use cache').
 * Only public list prices / public flash prices ever pass through here.
 *
 * Resilience: when the API is unreachable (e.g. `next build` without an API and
 * without mocks) list readers return empty data with a short lifetime instead of
 * failing the build; `getProductOrNull` / `getCategoryOrNull` return null ONLY for
 * a real 404 (or an unreachable API during the build), so pages can `notFound()`.
 */
import { cacheLife, cacheTag } from "next/cache";
import { ApiError } from "@/lib/api/client";
import * as api from "@/lib/api/storefront";
import type {
  Banner,
  Campaign,
  Category,
  FlashSaleCurrent,
  ListEnvelope,
  Product,
  ProductCard,
  ProductQuery,
  Review,
} from "@/lib/api/types";

const SHORT = { stale: 30, revalidate: 30, expire: 300 } as const;
const isBuild = () => process.env.NEXT_PHASE === "phase-production-build";
const emptyList = <T,>(): ListEnvelope<T> => ({ data: [], meta: { page: 1, per_page: 24, total: 0, total_pages: 0 } });

function unreachable(e: unknown) {
  return !(e instanceof ApiError) || e.status >= 500;
}

export async function categories(): Promise<Category[]> {
  "use cache";
  cacheTag("categories");
  try {
    const r = await api.getCategories();
    cacheLife("hours");
    return r;
  } catch {
    cacheLife(SHORT);
    return [];
  }
}

export async function categoryOrNull(slug: string): Promise<Category | null> {
  "use cache";
  cacheTag("categories", `category:${slug}`);
  try {
    const r = await api.getCategory(slug);
    cacheLife("hours");
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      cacheLife("minutes");
      return null;
    }
    if (isBuild() && unreachable(e)) {
      cacheLife(SHORT);
      return null;
    }
    throw e;
  }
}

export async function products(q: ProductQuery): Promise<ListEnvelope<ProductCard>> {
  "use cache";
  cacheTag("products");
  try {
    const r = await api.getProducts(q);
    cacheLife("minutes");
    return r;
  } catch {
    cacheLife(SHORT);
    return emptyList();
  }
}

export async function productOrNull(slug: string): Promise<Product | null> {
  "use cache";
  cacheTag("products", `product:${slug}`);
  try {
    const r = await api.getProduct(slug);
    cacheLife("minutes");
    return r;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      cacheLife("minutes");
      return null;
    }
    if (isBuild() && unreachable(e)) {
      cacheLife(SHORT);
      return null;
    }
    throw e;
  }
}

export async function related(slug: string): Promise<ProductCard[]> {
  "use cache";
  cacheTag("products", `product:${slug}`);
  try {
    const r = await api.getRelated(slug);
    cacheLife("minutes");
    return r;
  } catch {
    cacheLife(SHORT);
    return [];
  }
}

export async function reviewsFirstPage(slug: string): Promise<ListEnvelope<Review>> {
  "use cache";
  cacheTag(`reviews:${slug}`);
  try {
    const r = await api.getReviews(slug, { page: 1 });
    cacheLife("minutes");
    return r;
  } catch {
    cacheLife(SHORT);
    return emptyList();
  }
}

export async function activeCampaign(): Promise<Campaign | null> {
  "use cache";
  cacheTag("campaigns");
  try {
    const r = await api.getActiveCampaign();
    cacheLife("minutes");
    return r;
  } catch {
    cacheLife(SHORT);
    return null;
  }
}

export async function banners(placement: Banner["placement"], category?: string): Promise<Banner[]> {
  "use cache";
  cacheTag("banners");
  try {
    const r = await api.getBanners(placement, category);
    cacheLife("minutes");
    return r;
  } catch {
    cacheLife(SHORT);
    return [];
  }
}

export async function flashSales(): Promise<FlashSaleCurrent> {
  "use cache";
  cacheTag("flash-sales");
  try {
    const r = await api.getFlashSales();
    cacheLife("minutes");
    return r;
  } catch {
    cacheLife(SHORT);
    return { current: null, next: null };
  }
}

/** Product slugs to prerender at build time (≥ 1 entry, required by ensureStatic = "navigation"). */
export async function popularSlugs(): Promise<string[]> {
  "use cache";
  cacheTag("products");
  try {
    const r = await api.getProducts({ sort: "best_selling", per_page: 24 });
    cacheLife("hours");
    return r.data.map((p) => p.slug);
  } catch {
    cacheLife(SHORT);
    return [];
  }
}

/** Default (in-stock) variant per product for client-side /offers lookups. Public data only. */
export async function defaultVariants(slugs: string[]): Promise<Record<string, number>> {
  "use cache";
  cacheTag("products");
  cacheLife("minutes");
  const out: Record<string, number> = {};
  await Promise.all(
    slugs.map(async (s) => {
      const p = await productOrNull(s).catch(() => null);
      const v = p?.variants.find((x) => x.in_stock) ?? p?.variants[0];
      if (v) out[s] = v.id;
    }),
  );
  return out;
}
