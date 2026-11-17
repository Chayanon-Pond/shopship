import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/account/auth";

export const metadata: Metadata = { title: "เข้าสู่ระบบ", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <LoginForm />
    </Suspense>
  );
}
