import type { Metadata } from "next";
import { FlashSaleSection } from "@/components/home/flash-sale";
import { ListingJsonLd, flashListing } from "@/components/seo";
import { pageMetadata } from "@/components/seo/meta";
import { flashSales } from "../_lib/data";

export const metadata: Metadata = pageMetadata({
  title: "Flash Sale ลดแรงจำกัดเวลา",
  description: "Flash Sale ShopShip ลดแรงจำกัดเวลาและจำนวน นับถอยหลังสด ราคาขีดฆ่าคือราคาต่ำสุด 30 วันก่อนโปร",
  path: "/flash-sale",
});

export default async function FlashSalePage() {
  const data = await flashSales();
  return (
    <>
      <ListingJsonLd name="Flash Sale" crumbs={[{ name: "หน้าแรก", url: "/" }, { name: "Flash Sale", url: "/flash-sale" }]} products={flashListing(data.current)} />
      <div className="container-page pt-10 text-center md:pt-16">
        <p className="text-sm font-semibold text-sale">ลดแรง จำกัดเวลา จำกัดจำนวน</p>
        <h1 className="mt-1 text-[44px] font-semibold leading-tight tracking-[-0.035em] md:text-[72px]">Flash Sale</h1>
        <p className="mx-auto mt-2 max-w-xl text-lg text-ink-2">
          {data.current?.label ?? data.next?.label ?? "รอบถัดไปเร็ว ๆ นี้"} · จำกัดจำนวนต่อคน ราคาจริงคำนวณในตะกร้า
        </p>
      </div>
      {data.current || data.next ? (
        <FlashSaleSection data={data} limit={48} showAllLink={false} layout="grid" />
      ) : (
        <p className="container-page py-16 text-center text-ink-2">ยังไม่มี Flash Sale ในตอนนี้</p>
      )}
    </>
  );
}
