import type { MetadataRoute } from "next";
import { productSitemapChunk, productSitemapCount } from "@/components/seo/sitemaps";
import { site } from "@/lib/site";

// Product sitemaps, split by count (/sitemaps/products/sitemap/<id>.xml), listed in /sitemap_index.xml.
// No lastmod: the public API exposes no updated_at, and a guessed date is worse than none.

export async function generateSitemaps() {
  const n = await productSitemapCount();
  return Array.from({ length: n }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const list = await productSitemapChunk(Number(await id) || 0);
  const abs = (u: string) => (/^https?:\/\//.test(u) ? u : `${site.url}${u}`);
  return list.map((p) => ({
    url: `${site.url}/p/${p.slug}`,
    changeFrequency: "daily" as const,
    priority: 0.6,
    ...(p.image ? { images: [abs(p.image.url)] } : {}),
  }));
}
