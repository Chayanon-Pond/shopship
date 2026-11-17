import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/account/auth";

export const metadata: Metadata = { title: "สมัครสมาชิก", robots: { index: false, follow: true } };

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" />}>
      <RegisterForm />
    </Suspense>
  );
}
