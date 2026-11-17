import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CampaignHero } from "@/components/home/campaign-hero";
import { FlashSaleSection } from "@/components/home/flash-sale";
import { PromoCodes } from "@/components/home/promo-codes";
import { ProductGrid } from "@/components/product/grid";
import { ListingJsonLd } from "@/components/seo";
import { pageMetadata } from "@/components/seo/meta";
import { SectionHead } from "@/components/ui/primitives";
import { activeCampaign, defaultVariants, flashSales, products } from "../../_lib/data";

export const ensureStatic = "navigation";
// Intentionally blocking on params (real 404s for unknown slugs instead of a soft-404 shell).
export const instant = false;

export async function generateStaticParams() {
  const c = await activeCampaign();
  return [{ slug: c?.slug ?? "__shell__" }];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await activeCampaign();
  if (!c || c.slug !== slug) return { title: "ไม่พบแคมเปญ", robots: { index: false } };
  const description = c.banners[0] ? `${c.banners[0].title} ${c.banners[0].subtitle}`.trim() : `${c.name} ที่ ShopShip`;
  const hero = c.theme.hero_image_url || c.banners[0]?.image_url;
  return pageMetadata({ title: c.name, description, path: `/campaign/${c.slug}`, image: hero ? { url: hero, alt: c.name } : null });
}

/** Seasonal campaign landing. Only the ACTIVE campaign has a page (the public API exposes `/campaigns/active`). */
export default async function CampaignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await activeCampaign();
  if (!c || c.slug !== slug) notFound();
  const [flash, onSale] = await Promise.all([flashSales(), products({ on_sale: true, sort: "best_selling", per_page: 24 })]);
  const variants = await defaultVariants(onSale.data.map((p) => p.slug));
  return (
    <>
      <ListingJsonLd
        name={c.name}
        crumbs={[{ name: "หน้าแรก", url: "/" }, { name: "โปรโมชัน", url: "/promotions" }, { name: c.name, url: `/campaign/${c.slug}` }]}
        products={onSale.data}
      />
      <CampaignHero campaign={c} />
      {c.promo_codes?.length ? (
        <section className="bg-canvas-alt py-14 md:py-20" aria-labelledby="codes-title">
          <div className="container-page">
            <SectionHead id="codes-title" title={`โค้ด ${c.theme.badge_text || c.name}`} sub="คัดลอกแล้ววางในหน้าตะกร้า ใช้ได้ 1 โค้ดต่อออเดอร์" />
            <PromoCodes codes={c.promo_codes} accent={c.theme.accent} />
          </div>
        </section>
      ) : null}
      {flash.current ? <FlashSaleSection data={flash} /> : null}
      <section className="container-page py-14 md:py-20" aria-labelledby="sale-title">
        <SectionHead id="sale-title" title="สินค้าร่วมแคมเปญ" sub="ลดราคา ซื้อ X แถม Y และราคาส่ง" />
        {onSale.data.length ? <ProductGrid products={onSale.data} variants={variants} /> : <p className="text-ink-2">กำลังเตรียมสินค้าร่วมรายการ</p>}
      </section>
    </>
  );
}
