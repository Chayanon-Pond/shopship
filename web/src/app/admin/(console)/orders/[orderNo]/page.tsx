import { Suspense } from "react";
import { OrderDetailPage } from "@/components/admin/pages/order-detail";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "รายละเอียดคำสั่งซื้อ" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <OrderDetailPage />
    </Suspense>
  );
}
