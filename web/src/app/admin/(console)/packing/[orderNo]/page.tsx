import { Suspense } from "react";
import { PackingViewPage } from "@/components/admin/pages/packing";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "แพ็คคำสั่งซื้อ" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <PackingViewPage />
    </Suspense>
  );
}
