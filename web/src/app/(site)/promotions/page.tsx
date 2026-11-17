import type { Metadata } from "next";
import { ArrowRight, CreditCard, QrCode, Truck, Zap } from "lucide-react";
import Link from "next/link";
import { FlashSaleSection } from "@/components/home/flash-sale";
import { PromoCodes } from "@/components/home/promo-codes";
import { MemberStrip } from "@/components/home/sections";
import { FreeShipBanner, TradeStrip } from "@/components/home/sections-static";
import { Countdown } from "@/components/ui/motion";
import { Img, SectionHead } from "@/components/ui/primitives";
import { pageMetadata } from "@/components/seo/meta";
import { activeCampaign, flashSales } from "../_lib/data";

export const metadata: Metadata = pageMetadata({
  title: "โปรโมชันและโค้ดส่วนลด",
  description: "รวมโปรโมชัน ShopShip: แคมเปญตามเทศกาล โค้ดส่วนลด Flash Sale ราคาส่งเมื่อซื้อจำนวนมาก และสิทธิ์สมาชิก",
  path: "/promotions",
});

const RULES = [
  ["ใช้ได้ 1 โค้ดต่อออเดอร์", "พิมพ์โค้ดในหน้าตะกร้า ระบบจะบอกทันทีว่าใช้ได้หรือไม่ และเพราะอะไร"],
  ["ส่วนลดอัตโนมัติไม่ต้องใช้โค้ด", "ราคาส่ง ราคาสมาชิก ซื้อ X แถม Y และ “ช้อปครบลด” คำนวณให้ในตะกร้าเอง"],
  ["โค้ดพิเศษบางตัวใช้ร่วมกับโปรอื่นไม่ได้", "ระบบจะเลือกส่วนลดที่คุ้มกว่าให้คุณอัตโนมัติ"],
  ["ราคาขีดฆ่าตรงไปตรงมา", "คือราคาต่ำสุดของสินค้าใน 30 วันก่อนเริ่มโปรโมชัน ไม่ใช่ราคาตั้งลอย ๆ"],
] as const;

export default async function PromotionsPage() {
  const [campaign, flash] = await Promise.all([activeCampaign(), flashSales()]);
  const accent = campaign?.theme.accent || "#0071e3";
  return (
    <>
      <div className="container-page pb-8 pt-10 text-center md:pt-16">
        <h1 className="text-[44px] font-semibold leading-tight tracking-[-0.035em] md:text-[72px]">โปรโมชัน</h1>
        <p className="mx-auto mt-2 max-w-xl text-lg text-ink-2 md:text-xl">แคมเปญตามเทศกาล โค้ดส่วนลด Flash Sale ราคาส่ง และสิทธิ์สมาชิก — รวมไว้ที่เดียว</p>
      </div>

      {campaign ? (
        <section className="container-page py-6" aria-labelledby="cmp-title">
          <Link href={`/campaign/${campaign.slug}`} className="group relative block overflow-hidden rounded-[28px] bg-canvas-alt">
            <div className="relative aspect-[4/3] sm:aspect-[21/9]">
              <Img
                src={campaign.theme.hero_image_url || campaign.banners[0]?.image_url || ""}
                alt={campaign.name}
                fill
                sizes="(min-width:1240px) 1200px, 100vw"
                className="object-cover transition-transform duration-1000 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white md:p-10">
                <p className="text-sm font-semibold opacity-90">แคมเปญตอนนี้ · {campaign.theme.badge_text || campaign.season_tag}</p>
                <h2 id="cmp-title" className="text-[32px] font-semibold tracking-[-0.03em] md:text-[56px]">
                  {campaign.name}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    เหลือเวลา <Countdown to={campaign.ends_at} label="แคมเปญสิ้นสุดใน" />
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold">
                    ดูแคมเปญ <ArrowRight className="size-4 transition group-hover:translate-x-1" aria-hidden />
                  </span>
                </div>
              </div>
            </div>
          </Link>
        </section>
      ) : null}

      <section className="bg-canvas-alt py-14 md:py-20" aria-labelledby="codes-title">
        <div className="container-page">
          <SectionHead id="codes-title" title="โค้ดส่วนลด" sub="กดคัดลอก แล้ววางในหน้าตะกร้า" />
          <PromoCodes codes={campaign?.promo_codes ?? []} accent={accent} />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {RULES.map(([t, b]) => (
              <li key={t} className="rounded-tile bg-white p-5">
                <p className="font-semibold">{t}</p>
                <p className="mt-1 text-sm text-ink-2">{b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {flash.current || flash.next ? <FlashSaleSection data={flash} /> : null}
      <div className="py-6">
        <TradeStrip />
      </div>
      <MemberStrip />
      <FreeShipBanner />

      <section className="container-page grid gap-4 py-12 md:grid-cols-3" aria-label="การชำระเงินและจัดส่ง">
        <div id="payment" className="scroll-mt-28 rounded-tile bg-canvas-alt p-6">
          <QrCode className="size-7" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">PromptPay QR</h2>
          <p className="mt-1 text-sm text-ink-2">สแกนจ่ายด้วยแอปธนาคารใดก็ได้ ยืนยันอัตโนมัติภายในไม่กี่วินาที</p>
        </div>
        <div className="rounded-tile bg-canvas-alt p-6">
          <CreditCard className="size-7" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">บัตรเครดิต / เดบิต</h2>
          <p className="mt-1 text-sm text-ink-2">Visa, Mastercard, JCB ยืนยันตัวตน 3-D Secure</p>
        </div>
        <div id="shipping" className="scroll-mt-28 rounded-tile bg-canvas-alt p-6">
          <Truck className="size-7" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">จัดส่ง Flash Express</h2>
          <p className="mt-1 text-sm text-ink-2">ค่าส่ง ฿40 ทั่วประเทศ ส่งฟรีเมื่อช้อปครบ ฿990 ได้รับใน 1–3 วัน</p>
        </div>
      </section>
      <div className="container-page pb-16 text-center">
        <Link href="/flash-sale" className="btn btn-primary">
          <Zap className="size-4" fill="currentColor" aria-hidden /> ไปที่ Flash Sale
        </Link>
      </div>
    </>
  );
}
