import { Suspense } from "react";
import { InventoryPage } from "@/components/admin/pages/inventory";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "สต็อก" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <InventoryPage />
    </Suspense>
  );
}
