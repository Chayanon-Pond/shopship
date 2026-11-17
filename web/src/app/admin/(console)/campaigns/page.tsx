import { Suspense } from "react";
import { PromotionsHub } from "@/components/admin/pages/promotions/hub";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "แคมเปญตามฤดูกาล" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <PromotionsHub defaultTab="campaigns" />
    </Suspense>
  );
}
