import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "@/components/account/auth";

export const metadata: Metadata = { title: "ตั้งรหัสผ่านใหม่", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <ResetForm />
    </Suspense>
  );
}
