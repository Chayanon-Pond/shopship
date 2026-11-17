import { Suspense } from "react";
import { LoginForm } from "@/components/admin/pages/login";

export const metadata = { title: "เข้าสู่ระบบหลังร้าน" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
