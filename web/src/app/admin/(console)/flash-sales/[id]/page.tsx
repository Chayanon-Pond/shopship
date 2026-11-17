import { Suspense } from "react";
import { FlashEditorPage } from "@/components/admin/pages/flash-editor";
import { PageFallback } from "@/components/admin/ui";

// Client-rendered behind the console session gate (no-store data): not part of the static shell.
export const instant = false;

export const metadata = { title: "แก้ไข Flash Sale" };

export default function Page() {
  return (
    <Suspense fallback={<PageFallback />}>
      <FlashEditorPage />
    </Suspense>
  );
}
