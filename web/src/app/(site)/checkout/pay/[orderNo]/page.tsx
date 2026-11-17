import type { Metadata } from "next";
import { Suspense } from "react";
import { PayView } from "@/components/checkout/pay-view";
import { Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "ชำระเงิน", robots: { index: false, follow: false } };

// Personal page: order + charge are fetched client-side (no-store); URL data read inside <Suspense>.
export default function PayPage() {
  return (
    <div className="container-page pb-16 pt-8 md:pt-12">
      <Suspense fallback={<Skeleton className="mx-auto h-[520px] max-w-xl rounded-[28px]" />}>
        <PayView />
      </Suspense>
    </div>
  );
}
