import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/**
 * Storefront crawlable; private / transactional areas and internal search are not.
 * Sort / filter variants of listings (?sort=, ?min_price=, …) are blocked from crawling — their canonical is the
 * clean URL and they only add duplicate content. Tracking params (utm_*, fbclid, gclid) stay crawlable so the
 * canonical on those URLs can be seen.
 */
const LISTING_PARAMS = ["sort", "page", "min_price", "max_price", "rating_min", "in_stock", "on_sale", "tag"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api/",
        "/account",
        "/cart",
        "/checkout",
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/search?",
        ...LISTING_PARAMS.flatMap((k) => [`/*?${k}=`, `/*&${k}=`]),
      ],
    },
    sitemap: [`${site.url}/sitemap_index.xml`],
  };
}
