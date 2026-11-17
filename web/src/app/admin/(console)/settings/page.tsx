import { Suspense } from "react";
import { SettingsPage } from "@/components/admin/pages/settings";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "ตั้งค่า" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <SettingsPage />
    </Suspense>
  );
}
