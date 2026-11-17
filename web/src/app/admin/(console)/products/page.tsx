import { Suspense } from "react";
import { ProductsPage } from "@/components/admin/pages/products";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "สินค้า" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ProductsPage />
    </Suspense>
  );
}
