import { Suspense } from "react";
import { AuditPage } from "@/components/admin/pages/audit";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "บันทึกการใช้งาน" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <AuditPage />
    </Suspense>
  );
}
