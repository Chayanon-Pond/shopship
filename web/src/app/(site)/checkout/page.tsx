import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const metadata: Metadata = { title: "ชำระเงิน", robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return (
    <div className="container-page pb-16 pt-8 md:pt-12">
      <h1 className="mb-6 text-[34px] font-semibold tracking-[-0.03em] md:mb-8 md:text-[48px]">ชำระเงิน</h1>
      <CheckoutView />
    </div>
  );
}
