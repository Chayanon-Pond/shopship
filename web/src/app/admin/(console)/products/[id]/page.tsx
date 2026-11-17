import { Suspense } from "react";
import { ProductEditorPage } from "@/components/admin/pages/product-editor";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "แก้ไขสินค้า" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ProductEditorPage />
    </Suspense>
  );
}
