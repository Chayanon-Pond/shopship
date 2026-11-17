import type { Metadata } from "next";
import { Suspense } from "react";
import { AccountShell, OrderDetailView } from "@/components/account/views";
import { Skeleton } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "รายละเอียดคำสั่งซื้อ" };

// Personal: order fetched client-side (no-store); the order number is read from the URL inside <Suspense>.
export default function OrderDetailPage() {
  return (
    <Suspense fallback={<div className="container-page py-12"><Skeleton className="h-96 rounded-[24px]" /></div>}>
      <AccountShell title="รายละเอียดคำสั่งซื้อ">
        <OrderDetailView />
      </AccountShell>
    </Suspense>
  );
}
