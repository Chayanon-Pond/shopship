import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotForm } from "@/components/account/auth";

export const metadata: Metadata = { title: "ลืมรหัสผ่าน", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <ForgotForm />
    </Suspense>
  );
}
