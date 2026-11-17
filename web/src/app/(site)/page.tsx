import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { BannerCarousel } from "@/components/home/banner-carousel";
import { CampaignHero } from "@/components/home/campaign-hero";
import { CategoryTiles } from "@/components/home/category-tiles";
import { FlashSaleSection } from "@/components/home/flash-sale";
import { DealsForYou, Newsletter } from "@/components/home/sections";
import { FreeShipBanner, TradeStrip } from "@/components/home/sections-static";
import { ProductGrid } from "@/components/product/grid";
import { SiteJsonLd } from "@/components/seo";
import { SectionHead } from "@/components/ui/primitives";
import { site } from "@/lib/site";
import { activeCampaign, banners, categories, defaultVariants, flashSales, products } from "./_lib/data";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: site.name, locale: site.locale, title: site.title, description: site.description },
};

export default async function Home() {
  const [campaign, hero, flash, cats, best, fresh] = await Promise.all([
    activeCampaign(),
    banners("home_hero"),
    flashSales(),
    categories(),
    products({ sort: "best_selling", per_page: 8 }),
    products({ sort: "newest", per_page: 8 }),
  ]);
  const slugs = [...new Set([...best.data, ...fresh.data].map((p) => p.slug))];
  const variants = await defaultVariants(slugs);
  // the campaign's own banner already headlines the hero; the carousel shows the rest
  const carousel = hero.filter((b) => !campaign || b.campaign_id !== campaign.id || campaign.banners.length === 0);
  const tradeExample = best.data.find((p) => p.badges.some((b) => b.includes("ราคาส่ง")));

  return (
    <>
      <SiteJsonLd />
      <CampaignHero campaign={campaign} />
      {carousel.length ? (
        <div className="pb-4 pt-2 md:pt-6">
          <BannerCarousel banners={carousel} />
        </div>
      ) : null}
      <CategoryTiles categories={cats} />
      <FlashSaleSection data={flash} />
      <DealsForYou products={best.data} variants={variants} />
      <TradeStrip example={tradeExample ? { name: tradeExample.name, slug: tradeExample.slug } : undefined} />

      <section aria-labelledby="best-title" className="cv-section container-page py-12 md:py-16">
        <SectionHead
          id="best-title"
          title="ขายดีที่สุด"
          sub="สินค้าที่ลูกค้า ShopShip เลือกมากที่สุด"
          action={
            <Link href="/search?sort=best_selling" className="inline-flex items-center gap-0.5 text-[15px] text-link hover:underline">
              ดูทั้งหมด <ChevronRight className="size-4" aria-hidden />
            </Link>
          }
        />
        <ProductGrid products={best.data} variants={variants} />
      </section>

      <FreeShipBanner />

      <section aria-labelledby="new-title" className="cv-section container-page py-12 md:py-16">
        <SectionHead
          id="new-title"
          eyebrow="ใหม่"
          title="สินค้ามาใหม่"
          action={
            <Link href="/search?sort=newest" className="inline-flex items-center gap-0.5 text-[15px] text-link hover:underline">
              ดูทั้งหมด <ChevronRight className="size-4" aria-hidden />
            </Link>
          }
        />
        <ProductGrid products={fresh.data} variants={variants} />
      </section>

      <Newsletter />
    </>
  );
}
