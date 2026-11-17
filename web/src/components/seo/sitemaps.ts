import { products } from "@/app/(site)/_lib/data";
import type { ProductCard } from "@/lib/api/types";

/** API page size cap (docs/API.md §3) and API pages per product sitemap file → 4,800 URLs per file (limit 50,000). */
const PER_PAGE = 48;
const PAGES_PER_FILE = 100;

/** Number of product sitemap files (≥ 1 so the index never points at nothing). */
export async function productSitemapCount(): Promise<number> {
  const first = await products({ sort: "newest", per_page: 1, page: 1 });
  return Math.max(1, Math.ceil(first.meta.total / (PER_PAGE * PAGES_PER_FILE)));
}

/** Active products of sitemap file `id` (0-based), paginating the public catalog. */
export async function productSitemapChunk(id: number): Promise<ProductCard[]> {
  const from = id * PAGES_PER_FILE + 1;
  const first = await products({ sort: "newest", per_page: PER_PAGE, page: from });
  const last = Math.min(first.meta.total_pages, from + PAGES_PER_FILE - 1);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, last - from) }, (_, i) => products({ sort: "newest", per_page: PER_PAGE, page: from + 1 + i })),
  );
  return [...first.data, ...rest.flatMap((r) => r.data)];
}

export const productSitemapPath = (id: number) => `/sitemaps/products/sitemap/${id}.xml`;
