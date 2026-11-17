import { Suspense } from "react";
import { ReviewsPage } from "@/components/admin/pages/reviews";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "รีวิว" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <ReviewsPage />
    </Suspense>
  );
}
