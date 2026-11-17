import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs, Description } from "@/components/product/bits";
import { ProductDetail } from "@/components/product/detail";
import { ProductRail } from "@/components/product/grid";
import { Reviews } from "@/components/product/reviews";
import { ProductJsonLd, categoryCrumbs } from "@/components/seo";
import { pageMetadata } from "@/components/seo/meta";
import { SectionHead } from "@/components/ui/primitives";
import { formatBaht } from "@/lib/money";
import { activeCampaign, popularSlugs, productOrNull, related, reviewsFirstPage } from "../../_lib/data";

// Real 404s for unknown slugs (params + product read outside Suspense; the whole page is static/ISR).
export const ensureStatic = "navigation";
// Intentionally blocking on params (real 404s for unknown slugs instead of a soft-404 shell).
export const instant = false;

export async function generateStaticParams() {
  const slugs = await popularSlugs();
  return (slugs.length ? slugs : ["__shell__"]).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = await productOrNull(slug);
  if (!p) return { title: "ไม่พบสินค้า", robots: { index: false } };
  const title = p.seo.title?.replace(/\s*\|\s*ShopShip\s*$/i, "") || p.name;
  // public LIST price only (never member / trade prices)
  const price = `ราคา${p.max_price_satang > p.min_price_satang ? "เริ่มต้น " : " "}${formatBaht(p.min_price_satang)}`;
  // a short admin SEO description is extended with the name + public price (snippets want ~70–155 chars)
  const own = (p.seo?.description ?? "").trim();
  const description = own.length >= 70 ? own : `${p.name} ${own || p.subtitle} ${price} ส่งไวทั่วไทย`.replace(/\s+/g, " ").trim();
  return pageMetadata({ title, description, path: `/p/${p.slug}`, image: p.images[0] ?? p.image, fileImage: true });
}

export default async function ProductPage({ params }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const p = await productOrNull(slug);
  if (!p) notFound();
  const [reviews, rel, campaign] = await Promise.all([reviewsFirstPage(slug), related(slug), activeCampaign()]);
  const crumbs = categoryCrumbs(p.breadcrumbs);

  return (
    <>
      <ProductJsonLd slug={p.slug} />
      <div className="container-page pt-4 md:pt-6">
        <Breadcrumbs items={[...crumbs.map((c) => ({ name: c.name, href: c.url })), { name: p.name }]} />
      </div>
      <div className="container-page pt-4 md:pt-8">
        <ProductDetail p={p} codes={campaign?.promo_codes ?? []} />
      </div>

      {p.description ? (
        <section aria-labelledby="desc-title" className="container-page py-14 md:py-20">
          <div className="grid gap-6 md:grid-cols-[280px_1fr] lg:gap-12">
            <h2 id="desc-title" className="text-[28px] font-semibold tracking-[-0.02em] md:text-[36px]">
              รายละเอียดสินค้า
            </h2>
            <div className="max-w-2xl">
              <Description text={p.description} />
              {p.variants.length ? (
                <dl className="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-hairline-soft pt-6 text-sm">
                  <dt className="text-ink-2">หมวดหมู่</dt>
                  <dd>{p.breadcrumbs.map((b) => b.name).join(" › ")}</dd>
                  {p.brand ? (
                    <>
                      <dt className="text-ink-2">แบรนด์</dt>
                      <dd>{p.brand}</dd>
                    </>
                  ) : null}
                  <dt className="text-ink-2">รหัสสินค้า</dt>
                  <dd className="font-mono text-[13px]">{p.variants.map((v) => v.sku).join(", ")}</dd>
                </dl>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <div className="container-page border-t border-hairline-soft py-14 md:py-20">
        <Reviews slug={p.slug} summary={p.reviews_summary} initial={reviews} />
      </div>

      {rel.length ? (
        <section aria-labelledby="rel-title" className="cv-section bg-canvas-alt py-14 md:py-20">
          <div className="container-page">
            <SectionHead id="rel-title" title="สินค้าที่เกี่ยวข้อง" sub="ลูกค้าที่ดูสินค้านี้มักสนใจ" />
            <ProductRail products={rel} />
          </div>
        </section>
      ) : null}
    </>
  );
}
