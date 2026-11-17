import { Suspense } from "react";
import { ShippingLabel } from "@/components/admin/pages/label";

export const metadata = { title: "ใบปะหน้าพัสดุ" };

// Printable placeholder label (mock carrier). Outside the console chrome on purpose.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShippingLabel />
    </Suspense>
  );
}
