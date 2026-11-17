import { Suspense } from "react";
import { CategoriesPage } from "@/components/admin/pages/categories";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "หมวดหมู่" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <CategoriesPage />
    </Suspense>
  );
}
