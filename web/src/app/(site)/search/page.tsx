import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductBrowser } from "@/components/product/browser";
import { GridSkeleton } from "@/components/product/grid";

export const metadata: Metadata = {
  title: "ค้นหาสินค้า",
  description: "ค้นหาสินค้าบน ShopShip ทั้งภาษาไทยและอังกฤษ พิมพ์ผิดนิดหน่อยก็เจอ",
  alternates: { canonical: "/search" },
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return (
    <div className="container-page pb-16 pt-6 md:pt-10">
      <Suspense
        fallback={
          <>
            <h1 className="mb-6 text-[34px] font-semibold tracking-[-0.03em] md:text-[48px]">ค้นหาสินค้า</h1>
            <GridSkeleton />
          </>
        }
      >
        <ProductBrowser base={{}} heading="search" />
      </Suspense>
    </div>
  );
}
