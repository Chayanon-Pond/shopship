import { Suspense } from "react";
import { StaffPage } from "@/components/admin/pages/customers";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "ผู้ใช้หลังร้าน" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <StaffPage />
    </Suspense>
  );
}
