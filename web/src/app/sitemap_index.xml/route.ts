import { cacheLife, cacheTag } from "next/cache";
import { productSitemapCount, productSitemapPath } from "@/components/seo/sitemaps";
import { site } from "@/lib/site";

/** Sitemap index: the core sitemap + one file per 4,800 products. Referenced from robots.txt. */
async function indexXml() {
  "use cache";
  cacheTag("products", "categories");
  cacheLife("hours");
  const n = await productSitemapCount();
  const files = ["/sitemap.xml", ...Array.from({ length: n }, (_, i) => productSitemapPath(i))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files
    .map((f) => `<sitemap><loc>${site.url}${f}</loc></sitemap>`)
    .join("\n")}\n</sitemapindex>\n`;
}

export async function GET() {
  return new Response(await indexXml(), { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
