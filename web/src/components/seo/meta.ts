import type { Metadata } from "next";
import type { Image } from "@/lib/api/types";
import { site } from "@/lib/site";
import { isRaster } from "./schema";
import { clampText } from "./text";

/** Root title template is "%s | ShopShip" → keep the page part short enough for ≤ 60 characters in total. */
const SUFFIX = ` | ${site.name}`;
export const TITLE_MAX = 60 - SUFFIX.length;
export const DESCRIPTION_MAX = 155;

/** Site-wide share card (app/(site)/opengraph-image.tsx served at a stable URL by app/og.png/route.ts). */
export const DEFAULT_OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: site.title, type: "image/png" };

type Opts = {
  title: string;
  description: string;
  /** Clean path without query: canonical + og:url (tracking / sort / filter params never become canonical). */
  path: string;
  type?: "website" | "article";
  /** A product / category photo; only raster formats are used (social crawlers ignore SVG). */
  image?: (Pick<Image, "url"> & Partial<Image>) | null;
  /** The route has its own opengraph-image file: do not set images so the file wins. */
  fileImage?: boolean;
  noindex?: boolean;
};

/** Full per-page metadata: Next replaces (not merges) openGraph/twitter objects, so every field is set here. */
export function pageMetadata(o: Opts): Metadata {
  const title = clampText(o.title, TITLE_MAX);
  const description = clampText(o.description, DESCRIPTION_MAX);
  const full = `${title}${SUFFIX}`;
  const im = o.image;
  const photo =
    im?.url && isRaster(im.url)
      ? [{ url: im.url, ...(im.width && im.height ? { width: im.width, height: im.height } : {}), alt: im.alt || title }]
      : null;
  const images = photo ?? (o.fileImage ? null : [DEFAULT_OG_IMAGE]);
  return {
    title,
    description,
    alternates: { canonical: o.path },
    openGraph: {
      type: o.type ?? "website",
      url: o.path,
      siteName: site.name,
      locale: site.locale,
      title: full,
      description,
      ...(images ? { images } : {}),
    },
    twitter: { card: "summary_large_image", title: full, description, ...(images ? { images } : {}) },
    ...(o.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
