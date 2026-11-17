"use client";

import { CircleCheck, Eye, EyeOff, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api/client";
import * as api from "@/lib/api/storefront";
import { LogoMark } from "@/components/layout/logo";
import { errorText } from "@/components/store/cart";
import { useSession } from "@/components/store/session";
import { useToast } from "@/components/store/toast";
import { Reveal } from "@/components/ui/motion";

/** Only same-site relative paths are accepted as ?next= (no open redirect). */
export function safeNext(v: string | null) {
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/account";
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="container-page flex justify-center pb-16 pt-10 md:pt-16">
      <Reveal className="w-full max-w-[420px]">
        <LogoMark className="mx-auto size-12" />
        <h1 className="mt-5 text-center text-[32px] font-semibold tracking-[-0.03em]">{title}</h1>
        {sub ? <p className="mt-1 text-center text-ink-2">{sub}</p> : null}
        <div className="mt-8">{children}</div>
      </Reveal>
    </div>
  );
}

function Field({
  label,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  const [show, setShow] = useState(false);
  const pw = rest.type === "password";
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <span className="relative block">
        <input {...rest} type={pw && show ? "text" : rest.type} className="input h-12 pr-11" aria-invalid={!!error} />
        {pw ? (
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-ink-2 hover:bg-canvas-alt" aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}>
            {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        ) : null}
      </span>
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
    </label>
  );
}

export function LoginForm() {
  const { signIn, me, ready } = useSession();
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeNext(sp.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (ready && me) router.replace(next);
  }, [ready, me, next, router]);
  return (
    <Card title="เข้าสู่ระบบ ShopShip" sub="ดูราคาสมาชิก ราคาส่ง และติดตามคำสั่งซื้อ">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          setBusy(true);
          try {
            const m = await signIn(email.trim(), password);
            toast({ tone: "ok", text: `ยินดีต้อนรับ ${m.name}` });
            router.replace(next);
          } catch (er) {
            setErr(er instanceof ApiError && er.status === 429 ? "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่" : errorText(er));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="อีเมล" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="รหัสผ่าน" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="text-right">
          <Link href="/forgot-password" className="text-sm text-link hover:underline">
            ลืมรหัสผ่าน?
          </Link>
        </div>
        {err ? (
          <p className="rounded-[12px] bg-[#fdecee] p-3 text-sm text-danger" role="alert">
            {err}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary h-12 w-full" disabled={busy}>
          {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
        <button type="button" className="btn btn-secondary h-12 w-full" onClick={() => toast({ tone: "error", text: "เข้าสู่ระบบด้วย Google จะเปิดให้บริการเร็ว ๆ นี้" })}>
          ดำเนินการต่อด้วย Google
        </button>
      </form>
      <p className="mt-8 text-center text-sm text-ink-2">
        ยังไม่มีบัญชี?{" "}
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-link hover:underline">
          สมัครสมาชิก
        </Link>
      </p>
    </Card>
  );
}

export function RegisterForm() {
  const { signUp } = useSession();
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const next = safeNext(sp.get("next"));
  const [f, setF] = useState({ name: "", email: "", phone: "", password: "", marketing_consent: sp.get("newsletter") === "1" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const em = sessionStorage.getItem("shopship_newsletter_email");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is only readable after hydration
      if (em) setF((x) => ({ ...x, email: em }));
    } catch {
      /* ignore */
    }
  }, []);
  return (
    <Card title="สมัครสมาชิก" sub="รับราคาสมาชิกและโค้ดส่วนลดตั้งแต่ออเดอร์แรก">
      <form
        className="space-y-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const v: Record<string, string> = {};
          if (!f.name.trim()) v.name = "กรุณากรอกชื่อ";
          if (!/^\S+@\S+\.\S+$/.test(f.email)) v.email = "อีเมลไม่ถูกต้อง";
          if (f.password.length < 8) v.password = "รหัสผ่านอย่างน้อย 8 ตัวอักษร";
          setErrs(v);
          setErr("");
          if (Object.keys(v).length) return;
          setBusy(true);
          try {
            await signUp({ ...f, email: f.email.trim(), phone: f.phone.trim() || undefined });
            try {
              sessionStorage.removeItem("shopship_newsletter_email");
            } catch {
              /* ignore */
            }
            toast({ tone: "ok", text: "สมัครสมาชิกสำเร็จ ยินดีต้อนรับ!" });
            router.replace(next);
          } catch (er) {
            if (er instanceof ApiError && er.fields) setErrs(er.fields);
            setErr(errorText(er));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="ชื่อ-นามสกุล" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
        <Field label="อีเมล" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={errs.email} />
        <Field label="เบอร์โทรศัพท์ (ไม่บังคับ)" type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errs.phone} />
        <Field label="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={errs.password} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={f.marketing_consent} onChange={(e) => setF({ ...f, marketing_consent: e.target.checked })} />
          <span>ฉันต้องการรับข่าวสาร โค้ดส่วนลด และโปรโมชันทางอีเมล (ยกเลิกได้ทุกเมื่อ)</span>
        </label>
        {err ? (
          <p className="rounded-[12px] bg-[#fdecee] p-3 text-sm text-danger" role="alert">
            {err}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary h-12 w-full" disabled={busy}>
          {busy ? "กำลังสมัคร…" : "สมัครสมาชิก"}
        </button>
        <p className="text-center text-xs text-ink-2">การสมัครถือว่าคุณยอมรับเงื่อนไขการใช้บริการและนโยบายความเป็นส่วนตัวของ ShopShip</p>
      </form>
      <p className="mt-8 text-center text-sm text-ink-2">
        มีบัญชีแล้ว?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-link hover:underline">
          เข้าสู่ระบบ
        </Link>
      </p>
    </Card>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (sent)
    return (
      <Card title="ตรวจสอบอีเมลของคุณ">
        <div className="text-center">
          <Mail className="mx-auto size-10 text-link" aria-hidden />
          <p className="mt-3 text-ink-2">หากอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว ลิงก์ใช้ได้ 1 ชั่วโมง</p>
          <Link href="/login" className="btn btn-primary mt-6">
            กลับไปเข้าสู่ระบบ
          </Link>
        </div>
      </Card>
    );
  return (
    <Card title="ลืมรหัสผ่าน" sub="กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await api.forgotPassword(email.trim()).catch(() => {});
          setBusy(false);
          setSent(true); // always the same answer (no account enumeration)
        }}
      >
        <Field label="อีเมล" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn btn-primary h-12 w-full" disabled={busy}>
          ส่งลิงก์ตั้งรหัสผ่าน
        </button>
      </form>
    </Card>
  );
}

export function ResetForm() {
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  if (done)
    return (
      <Card title="ตั้งรหัสผ่านใหม่แล้ว">
        <div className="text-center">
          <CircleCheck className="mx-auto size-10 text-success" aria-hidden />
          <p className="mt-3 text-ink-2">เพื่อความปลอดภัย อุปกรณ์อื่นถูกออกจากระบบทั้งหมดแล้ว</p>
          <Link href="/login" className="btn btn-primary mt-6">
            เข้าสู่ระบบ
          </Link>
        </div>
      </Card>
    );
  return (
    <Card title="ตั้งรหัสผ่านใหม่">
      {!token ? (
        <p className="text-center text-ink-2">
          ลิงก์ไม่ถูกต้องหรือหมดอายุ{" "}
          <Link href="/forgot-password" className="text-link hover:underline">
            ขอลิงก์ใหม่
          </Link>
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.length < 8) return setErr("รหัสผ่านอย่างน้อย 8 ตัวอักษร");
            if (pw !== pw2) return setErr("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
            try {
              await api.resetPassword(token, pw);
              setDone(true);
            } catch (er) {
              setErr(errorText(er));
            }
          }}
        >
          <Field label="รหัสผ่านใหม่" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Field label="ยืนยันรหัสผ่านใหม่" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {err ? <p className="text-sm text-danger">{err}</p> : null}
          <button type="submit" className="btn btn-primary h-12 w-full">
            บันทึกรหัสผ่านใหม่
          </button>
        </form>
      )}
    </Card>
  );
}
