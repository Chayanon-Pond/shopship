import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";

export const metadata: Metadata = { title: "ตะกร้าสินค้า", robots: { index: false, follow: false } };

export default function CartPage() {
  return (
    <div className="container-page pb-16 pt-8 md:pt-12">
      <h1 className="mb-6 text-[34px] font-semibold tracking-[-0.03em] md:mb-8 md:text-[48px]">ตะกร้าของคุณ</h1>
      <CartView />
    </div>
  );
}
