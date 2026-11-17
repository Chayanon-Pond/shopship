import { Suspense } from "react";
import { CustomersPage } from "@/components/admin/pages/customers";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "ลูกค้า" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <CustomersPage />
    </Suspense>
  );
}
