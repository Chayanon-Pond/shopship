import Image from "../(site)/opengraph-image";

/**
 * The site share card at a stable URL. File-based opengraph-image URLs carry a build hash and are not inherited by
 * child pages that set their own openGraph, so pages without their own image point here (components/seo/meta.ts).
 */
export async function GET() {
  return Image();
}
