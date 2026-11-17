import type { MetadataRoute } from "next";
import { activeCampaign, categories } from "./(site)/_lib/data";
import { site } from "@/lib/site";
import { LEGAL_PAGES, LEGAL_UPDATED } from "./(site)/legal/_components/legal-doc";

/**
 * Core pages: home, hubs, active campaign, every category, legal pages. Products are in
 * /sitemaps/products/sitemap/<n>.xml; /sitemap_index.xml lists all files (submit that one).
 * lastModified only where a real date exists (legal pages); the public API has no updated_at for catalog rows.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [tree, campaign] = await Promise.all([categories(), activeCampaign()]);
  const u = (p: string) => `${site.url}${p}`;
  return [
    { url: u("/"), changeFrequency: "daily", priority: 1 },
    { url: u("/promotions"), changeFrequency: "daily", priority: 0.8 },
    { url: u("/flash-sale"), changeFrequency: "hourly", priority: 0.8 },
    ...(campaign ? [{ url: u(`/campaign/${campaign.slug}`), changeFrequency: "daily" as const, priority: 0.8 }] : []),
    { url: u("/categories"), changeFrequency: "weekly", priority: 0.6 },
    ...tree.flatMap((c) => [c, ...c.children]).map((c) => ({ url: u(`/c/${c.slug}`), changeFrequency: "daily" as const, priority: 0.7 })),
    ...LEGAL_PAGES.map((p) => ({ url: u(`/legal/${p.slug}`), lastModified: LEGAL_UPDATED, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
