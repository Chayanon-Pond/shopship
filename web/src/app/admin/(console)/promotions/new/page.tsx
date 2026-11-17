import { Suspense } from "react";
import { PromotionEditorPage } from "@/components/admin/pages/promotions/editor";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "สร้างโปรโมชัน" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <PromotionEditorPage />
    </Suspense>
  );
}
