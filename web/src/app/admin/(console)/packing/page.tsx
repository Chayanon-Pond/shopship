import { Suspense } from "react";
import { PackingQueuePage } from "@/components/admin/pages/packing";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "แพ็คของ" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <PackingQueuePage />
    </Suspense>
  );
}
