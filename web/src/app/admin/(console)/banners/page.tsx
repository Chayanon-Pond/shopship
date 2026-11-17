import { Suspense } from "react";
import { BannersPage } from "@/components/admin/pages/banners";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "แบนเนอร์" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <BannersPage />
    </Suspense>
  );
}
