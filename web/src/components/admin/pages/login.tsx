"use client";

import { Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApiError, USE_MOCKS } from "@/lib/api/client";
import { adminLogin, adminLogout } from "@/lib/api/admin";
import { loginSchema, validate } from "@/lib/admin/schemas";
import { Button, Field, Input } from "../ui";

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next");
  const target = next && next.startsWith("/admin") && !next.startsWith("//") ? next : "/admin";
  const [email, setEmail] = useState(USE_MOCKS ? "owner@shopship.local" : "");
  const [password, setPassword] = useState(USE_MOCKS ? "mock-password" : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const v = validate(loginSchema, { email: email.trim(), password });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    try {
      const me = await adminLogin(v.data.email, v.data.password);
      if (me.role === "customer") {
        await adminLogout().catch(() => undefined);
        setFormError("บัญชีนี้เป็นบัญชีลูกค้า ไม่มีสิทธิ์เข้าหลังร้าน");
        return;
      }
      router.replace(target);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setFormError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      else if (err instanceof ApiError && err.status === 429) setFormError("พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่");
      else if (err instanceof ApiError && err.status === 403) setFormError("บัญชีนี้ถูกระงับการใช้งาน");
      else setFormError(err instanceof ApiError ? err.message : "เชื่อมต่อไม่ได้ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-[14px] bg-ink text-lg font-bold text-white">S</span>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">เข้าสู่ระบบหลังร้าน</h1>
          <p className="mt-1 text-sm text-ink-2">สำหรับเจ้าของร้าน แอดมิน และพนักงาน</p>
        </div>
        <form onSubmit={submit} noValidate className="rounded-[18px] border border-hairline-soft bg-surface p-6 shadow-[var(--shadow-tile)]">
          <div className="flex flex-col gap-4">
            <Field label="อีเมล" htmlFor="email" error={errors.email}>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} invalid={Boolean(errors.email)} className="h-11" />
            </Field>
            <Field label="รหัสผ่าน" htmlFor="password" error={errors.password}>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={Boolean(errors.password)} className="h-11" />
            </Field>
            {formError ? (
              <p role="alert" className="rounded-[10px] bg-[#fdecee] px-3 py-2 text-sm text-danger">
                {formError}
              </p>
            ) : null}
            <Button type="submit" variant="primary" size="lg" loading={busy} icon={Lock} className="w-full">
              เข้าสู่ระบบ
            </Button>
          </div>
        </form>
        {USE_MOCKS ? (
          <p className="mt-4 text-center text-xs text-ink-2">
            โหมดจำลอง: อีเมลที่มีคำว่า <code>staff</code> = พนักงาน, ขึ้นต้น <code>admin</code> = แอดมิน, มีคำว่า <code>customer</code> = ลูกค้า (403)
          </p>
        ) : null}
      </div>
    </main>
  );
}
