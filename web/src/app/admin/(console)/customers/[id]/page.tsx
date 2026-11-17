import { Suspense } from "react";
import { CustomerDetailPage } from "@/components/admin/pages/customers";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "ข้อมูลลูกค้า" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <CustomerDetailPage />
    </Suspense>
  );
}
