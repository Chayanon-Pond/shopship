import type { Metadata } from "next";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BannerCarousel } from "@/components/home/banner-carousel";
import { Breadcrumbs } from "@/components/product/bits";
import { ProductBrowser } from "@/components/product/browser";
import { ProductGrid } from "@/components/product/grid";
import { ListingJsonLd, categoryCrumbs } from "@/components/seo";
import { pageMetadata } from "@/components/seo/meta";
import { banners, categories, categoryOrNull, products } from "../../_lib/data";

export const ensureStatic = "navigation";
// Intentionally blocking on params (real 404s for unknown slugs instead of a soft-404 shell).
export const instant = false;

export async function generateStaticParams() {
  const tree = await categories();
  const slugs = tree.flatMap((c) => [c.slug, ...c.children.map((x) => x.slug)]);
  return (slugs.length ? slugs : ["__shell__"]).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = await categoryOrNull(slug);
  if (!c) return { title: "ไม่พบหมวดหมู่", robots: { index: false } };
  const count = c.product_count > 0 ? ` ${c.product_count} รายการ` : "";
  const own = (c.description ?? "").trim();
  const description = own.length >= 70 ? own : `${own ? `${own} ` : ""}ช้อป${c.name}คุณภาพดี${count}ที่ ShopShip โปรโมชันทุกวัน จ่ายง่ายด้วย PromptPay ส่งไวทั่วไทย`;
  return pageMetadata({ title: `${c.name} ราคาดี ส่งไวทั่วไทย`, description, path: `/c/${c.slug}`, image: c.image_url ? { url: c.image_url, alt: c.name } : null });
}

export default async function CategoryPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const c = await categoryOrNull(slug);
  if (!c) notFound();
  const [initial, top] = await Promise.all([products({ category: slug, sort: "newest", per_page: 24 }), banners("category_top", slug)]);
  const crumbs = categoryCrumbs(c.breadcrumbs ?? [{ id: c.id, slug: c.slug, name: c.name }]);
  const tree = await categories();
  const parent = c.parent_id ? tree.find((t) => t.id === c.parent_id) : null;
  const siblings = c.children.length ? c.children : (parent?.children ?? []);

  return (
    <>
      <ListingJsonLd name={c.name} crumbs={crumbs} products={initial.data} />
      <div className="container-page pt-4 md:pt-6">
        <Breadcrumbs items={crumbs.map((x, i) => ({ name: x.name, href: i < crumbs.length - 1 ? x.url : undefined }))} />
        <header className="pb-6 pt-6 md:pb-8 md:pt-10">
          <h1 className="text-[40px] font-semibold leading-tight tracking-[-0.03em] md:text-[64px]">{c.name}</h1>
          {c.description ? <p className="mt-2 max-w-2xl text-lg text-ink-2">{c.description}</p> : null}
          {siblings.length ? (
            <nav aria-label="หมวดย่อย" className="no-scrollbar -mx-[var(--page-gutter)] mt-5 flex gap-2 overflow-x-auto px-[var(--page-gutter)]">
              {parent || c.children.length ? (
                <Link
                  href={`/c/${parent?.slug ?? c.slug}`}
                  className={`shrink-0 rounded-pill px-4 py-2 text-sm font-medium transition ${!parent ? "bg-ink text-white" : "bg-canvas-alt hover:bg-hairline-soft"}`}
                >
                  ทั้งหมด
                </Link>
              ) : null}
              {siblings.map((s) => (
                <Link
                  key={s.id}
                  href={`/c/${s.slug}`}
                  aria-current={s.slug === c.slug ? "page" : undefined}
                  className={`shrink-0 rounded-pill px-4 py-2 text-sm font-medium transition ${s.slug === c.slug ? "bg-ink text-white" : "bg-canvas-alt hover:bg-hairline-soft"}`}
                >
                  {s.name}
                </Link>
              ))}
            </nav>
          ) : null}
        </header>
      </div>
      {top.length ? (
        <div className="pb-8">
          <BannerCarousel banners={top} />
        </div>
      ) : null}
      <div className="container-page pb-16">
        <Suspense fallback={<ProductGrid products={initial.data} cols="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4" priorityCount={2} />}>
          <ProductBrowser base={{ category: slug }} initial={initial} />
        </Suspense>
      </div>
    </>
  );
}
