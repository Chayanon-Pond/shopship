"use client";

import { clsx } from "clsx";
import { m } from "motion/react";
import { CircleAlert, CircleCheck, CreditCard, FlaskConical, Loader2, QrCode, RotateCcw, Smartphone } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, USE_MOCKS } from "@/lib/api/client";
import * as api from "@/lib/api/storefront";
import type { Charge, Order, PaymentMethod } from "@/lib/api/types";
import { formatBaht } from "@/lib/money";
import { errorText } from "@/components/store/cart";
import { useRequireLogin } from "@/components/store/session";
import { Countdown, EASE, Sheet, useNow } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/primitives";
import { MaxMotion } from "@/components/ui/motion-lazy";

/** Payment simulator buttons only where the mock provider exists (never in production). */
const SIMULATOR = USE_MOCKS || process.env.NEXT_PUBLIC_PAYMENT_MOCK === "true";

const TEST_CARDS = [
  { number: "4242 4242 4242 4242", token: "tokn_test_success", label: "ชำระสำเร็จทันที" },
  { number: "4000 0000 0000 3220", token: "tokn_test_3ds", label: "ต้องยืนยัน 3-D Secure" },
  { number: "4000 0000 0000 0002", token: "tokn_test_failure", label: "บัตรถูกปฏิเสธ" },
] as const;
export function tokenForTestCard(num: string): string | null {
  const n = num.replace(/\D/g, "");
  return TEST_CARDS.find((c) => c.number.replace(/\s/g, "") === n)?.token ?? null;
}

function PayViewInner() {
  const { me } = useRequireLogin();
  const { orderNo } = useParams<{ orderNo: string }>();
  const sp = useSearchParams();
  const mock3ds = sp.get("mock_3ds");
  const [order, setOrder] = useState<Order | null>(null);
  const [charge, setCharge] = useState<Charge | null>(null);
  const [method, setMethod] = useState<PaymentMethod>((sp.get("method") as PaymentMethod) === "card" ? "card" : "promptpay");
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(false);

  const loadOrder = useCallback(async () => {
    try {
      const o = await api.getOrder(orderNo);
      setOrder(o);
      return o;
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 404 ? "ไม่พบคำสั่งซื้อนี้" : errorText(e));
      return null;
    }
  }, [orderNo]);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const o = await loadOrder();
      if (!o) return;
      if (!sp.get("method")) setMethod(o.payment_method);
      if (o.payment?.charge_id) {
        try {
          setCharge(await api.getCharge(o.payment.charge_id));
        } catch {
          /* new charge below */
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, loadOrder]);

  // create the PromptPay charge (re-calling returns the open one)
  useEffect(() => {
    if (!order || order.status !== "pending_payment" || method !== "promptpay") return;
    if (charge && charge.method === "promptpay" && charge.status === "pending") return;
    if (charge && charge.method === "promptpay" && charge.status !== "failed") return;
    api
      .createCharge(order.order_no, "promptpay")
      .then(setCharge)
      .catch((e) => setErr(errorText(e)));
  }, [order, method, charge]);

  // poll every 3 s while pending / requires_action
  const poll = useCallback(async () => {
    if (!charge) return;
    try {
      const c = await api.getCharge(charge.charge_id);
      setCharge(c);
      if (c.status === "successful") await loadOrder();
    } catch {
      /* retry next tick */
    }
  }, [charge, loadOrder]);
  useEffect(() => {
    if (!charge || (charge.status !== "pending" && charge.status !== "requires_action")) return;
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [charge, poll]);

  if (!me || (!order && !err)) return <Skeleton className="mx-auto h-[520px] max-w-xl rounded-[28px]" />;
  if (err && !order)
    return (
      <div className="py-16 text-center">
        <p className="text-xl font-semibold">{err}</p>
        <Link href="/account/orders" className="btn btn-primary mt-5">
          ดูคำสั่งซื้อของฉัน
        </Link>
      </div>
    );
  const o = order!;
  const paid = o.status !== "pending_payment" && o.status !== "cancelled" ? true : charge?.status === "successful";
  if (paid) return <PaidScreen order={o} />;
  if (o.status === "cancelled")
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <CircleAlert className="mx-auto size-12 text-danger" aria-hidden />
        <p className="mt-4 text-2xl font-semibold">คำสั่งซื้อถูกยกเลิก</p>
        <p className="mt-1 text-ink-2">หมดเวลาชำระเงินหรือถูกยกเลิกแล้ว สินค้าถูกคืนเข้าสต็อก</p>
        <Link href="/cart" className="btn btn-primary mt-6">
          กลับไปที่ตะกร้า
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-xl">
      <div className="text-center">
        <p className="text-sm text-ink-2">คำสั่งซื้อ {o.order_no}</p>
        <h1 className="mt-1 text-[34px] font-semibold tracking-[-0.03em] md:text-[44px]">ชำระเงิน</h1>
        <p className="mt-1 text-[28px] font-semibold tabular-nums">{formatBaht(o.totals.grand_total_satang)}</p>
        <p className="mt-1 flex items-center justify-center gap-2 text-sm text-ink-2">
          ชำระภายใน <Countdown to={o.payment_due_at} label="เหลือเวลาชำระ" />
        </p>
      </div>
      <div className="mx-auto mt-6 flex w-fit rounded-pill bg-canvas-alt p-1" role="tablist" aria-label="วิธีชำระเงิน">
        {(
          [
            ["promptpay", "PromptPay", QrCode],
            ["card", "บัตร", CreditCard],
          ] as const
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={method === k}
            onClick={() => setMethod(k)}
            className={clsx("relative flex h-10 items-center gap-2 rounded-pill px-5 text-sm font-medium transition", method === k ? "text-ink" : "text-ink-2")}
          >
            {method === k ? <m.span layoutId="pay-tab" className="absolute inset-0 rounded-pill bg-white shadow-[0_1px_4px_rgb(0_0_0/0.08)]" transition={{ duration: 0.35, ease: EASE }} /> : null}
            <Icon className="relative size-4" aria-hidden />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      {err ? (
        <p className="mt-4 rounded-[14px] bg-[#fdecee] p-3 text-center text-sm text-danger" role="alert">
          {err}
        </p>
      ) : null}
      <div className="mt-6">
        {method === "promptpay" ? (
          <PromptPayPanel
            charge={charge?.method === "promptpay" ? charge : null}
            checking={checking}
            onPaid={async () => {
              setChecking(true);
              await poll();
              setTimeout(() => setChecking(false), 1200);
            }}
            onRenew={() => api.createCharge(o.order_no, "promptpay").then(setCharge).catch((e) => setErr(errorText(e)))}
            onSimulate={async (outcome) => {
              if (!charge) return;
              setCharge(await api.mockCompleteCharge(charge.charge_id, outcome));
              await loadOrder();
            }}
          />
        ) : (
          <CardPanel order={o} charge={charge?.method === "card" ? charge : null} onCharge={setCharge} onError={setErr} />
        )}
      </div>
      <Sheet open={!!mock3ds && charge?.status === "requires_action"} onClose={() => {}} title="3-D Secure (จำลอง)">
        <p className="text-ink-2">หน้านี้จำลองขั้นตอนยืนยันตัวตนของธนาคาร (โหมดทดสอบ ไม่มีการตัดเงินจริง)</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            className="btn btn-primary flex-1"
            onClick={async () => {
              setCharge(await api.mockCompleteCharge(mock3ds!, "successful"));
              await loadOrder();
            }}
          >
            อนุมัติ
          </button>
          <button type="button" className="btn btn-secondary flex-1" onClick={async () => setCharge(await api.mockCompleteCharge(mock3ds!, "failed"))}>
            ปฏิเสธ
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function PromptPayPanel({
  charge,
  checking,
  onPaid,
  onRenew,
  onSimulate,
}: {
  charge: Charge | null;
  checking: boolean;
  onPaid: () => void;
  onRenew: () => void;
  onSimulate: (o: "successful" | "failed") => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const now = useNow();
  const payload = charge?.promptpay?.qr_payload;
  useEffect(() => {
    if (!payload) return;
    QRCode.toDataURL(payload, { margin: 1, width: 560, errorCorrectionLevel: "M", color: { dark: "#1d1d1f", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [payload]);
  const expired = charge?.status === "expired" || (!!charge?.promptpay && !!now && new Date(charge.promptpay.expires_at).getTime() <= now);
  const failed = charge?.status === "failed";

  return (
    <div className="rounded-[28px] bg-canvas-alt p-6 text-center md:p-8">
      <div className="mx-auto flex w-fit items-center gap-2 rounded-pill bg-[#113566] px-4 py-1.5 text-sm font-semibold text-white">
        <QrCode className="size-4" aria-hidden /> Thai QR · PromptPay
      </div>
      <div className="relative mx-auto mt-5 aspect-square w-full max-w-[280px] overflow-hidden rounded-[20px] bg-white p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)]">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL generated client-side
          <img src={qr} alt="QR Code สำหรับชำระเงินผ่าน PromptPay" className={clsx("size-full transition", (expired || failed) && "opacity-15 blur-[2px]")} />
        ) : (
          <Skeleton className="size-full" />
        )}
        {expired || failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <p className="font-semibold">{failed ? "การชำระเงินไม่สำเร็จ" : "QR หมดอายุแล้ว"}</p>
            <button type="button" className="btn btn-primary h-10 text-sm" onClick={onRenew}>
              <RotateCcw className="size-4" aria-hidden /> สร้าง QR ใหม่
            </button>
          </div>
        ) : null}
      </div>
      {charge?.promptpay && !expired ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-ink-2">
          QR ใช้ได้อีก <Countdown to={charge.promptpay.expires_at} label="QR หมดอายุใน" />
        </p>
      ) : null}
      <ol className="mx-auto mt-5 max-w-sm space-y-1.5 text-left text-sm text-ink-2">
        <li className="flex gap-2">
          <Smartphone className="size-4 shrink-0" aria-hidden /> 1. เปิดแอปธนาคาร เลือกสแกน QR
        </li>
        <li className="pl-6">2. ตรวจยอดเงินและชื่อร้าน ShopShip แล้วยืนยัน</li>
        <li className="pl-6">3. หน้านี้จะอัปเดตอัตโนมัติเมื่อได้รับเงิน</li>
      </ol>
      <button type="button" className="btn btn-primary mt-6 w-full max-w-sm" onClick={onPaid} disabled={!charge || expired || checking}>
        {checking ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden /> กำลังตรวจสอบการชำระเงิน…
          </>
        ) : (
          "ฉันชำระเงินแล้ว"
        )}
      </button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-ink-3">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
        </span>
        กำลังรอการชำระเงิน (ตรวจสอบทุก 3 วินาที)
      </p>
      {SIMULATOR && charge?.status === "pending" ? (
        <div className="mx-auto mt-6 max-w-sm rounded-[16px] border border-dashed border-warning/50 bg-[#fff6e5] p-4 text-left">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
            <FlaskConical className="size-4" aria-hidden /> โหมดทดสอบ (TEST)
          </p>
          <p className="mt-1 text-xs text-ink-2">จำลองผู้จ่ายเงินผ่าน mock provider — ไม่มีเงินจริง</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn btn-secondary h-9 flex-1 bg-white text-sm" onClick={() => onSimulate("successful")}>
              จำลองจ่ายสำเร็จ
            </button>
            <button type="button" className="btn btn-secondary h-9 flex-1 bg-white text-sm" onClick={() => onSimulate("failed")}>
              จำลองไม่สำเร็จ
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CardPanel({ order, charge, onCharge, onError }: { order: Order; charge: Charge | null; onCharge: (c: Charge) => void; onError: (m: string) => void }) {
  const [num, setNum] = useState("");
  const [name, setName] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErr, setFieldErr] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setFieldErr("");
    const token = tokenForTestCard(num);
    if (!token) {
      setFieldErr("โหมดทดสอบ: ใช้หมายเลขบัตรทดสอบด้านล่างเท่านั้น");
      return;
    }
    if (!/^\d{2}\s*\/\s*\d{2}$/.test(exp) || !/^\d{3,4}$/.test(cvc) || !name.trim()) {
      setFieldErr("กรุณากรอกชื่อบนบัตร วันหมดอายุ (MM/YY) และ CVC ให้ครบ");
      return;
    }
    setBusy(true);
    onError("");
    try {
      const c = await api.createCharge(order.order_no, "card", token, window.location.origin + window.location.pathname + "?method=card");
      onCharge(c);
      if (c.status === "requires_action" && c.authorize_uri) window.location.assign(c.authorize_uri);
    } catch (er) {
      onError(errorText(er));
    } finally {
      setBusy(false);
    }
  }
  const fmtNum = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");

  return (
    <form ref={formRef} onSubmit={pay} className="rounded-[28px] bg-canvas-alt p-6 md:p-8" noValidate>
      <p className="mb-4 flex items-center gap-2 rounded-[12px] border border-dashed border-warning/50 bg-[#fff6e5] px-3 py-2 text-sm font-semibold text-warning">
        <FlaskConical className="size-4" aria-hidden /> TEST — โหมดทดสอบ ไม่มีการตัดเงินจริง
      </p>
      {charge?.status === "failed" ? (
        <p className="mb-4 flex items-center gap-2 rounded-[12px] bg-[#fdecee] p-3 text-sm text-danger" role="alert">
          <CircleAlert className="size-4" aria-hidden /> {charge.failure_message || "การชำระเงินไม่สำเร็จ"} — ลองบัตรอื่นได้
        </p>
      ) : null}
      {charge?.status === "requires_action" ? (
        <p className="mb-4 flex items-center gap-2 rounded-[12px] bg-accent-soft p-3 text-sm text-link">
          <Loader2 className="size-4 animate-spin" aria-hidden /> รอการยืนยัน 3-D Secure จากธนาคาร…
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2">
          <span className="mb-1 block text-sm font-medium">หมายเลขบัตร</span>
          <input className="input font-mono tracking-wider" inputMode="numeric" autoComplete="off" value={num} onChange={(e) => setNum(fmtNum(e.target.value))} placeholder="4242 4242 4242 4242" />
        </label>
        <label className="col-span-2">
          <span className="mb-1 block text-sm font-medium">ชื่อบนบัตร</span>
          <input className="input" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="SOMCHAI JAIDEE" />
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium">วันหมดอายุ</span>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="off"
            value={exp}
            onChange={(e) => setExp(e.target.value.replace(/[^\d]/g, "").slice(0, 4).replace(/(\d{2})(\d)/, "$1/$2"))}
            placeholder="MM/YY"
          />
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium">CVC</span>
          <input className="input" inputMode="numeric" autoComplete="off" value={cvc} onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="123" />
        </label>
      </div>
      {fieldErr ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {fieldErr}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary mt-5 h-[52px] w-full text-[17px]" disabled={busy || charge?.status === "requires_action"}>
        {busy ? "กำลังชำระเงิน…" : `ชำระ ${formatBaht(order.totals.grand_total_satang)}`}
      </button>
      <div className="mt-5 rounded-[16px] bg-white p-4 text-sm">
        <p className="font-semibold">บัตรทดสอบ (กดเพื่อกรอก)</p>
        <ul className="mt-2 space-y-1">
          {TEST_CARDS.map((c) => (
            <li key={c.token}>
              <button
                type="button"
                className="flex w-full justify-between gap-2 rounded-[8px] px-2 py-1 text-left hover:bg-canvas-alt"
                onClick={() => {
                  setNum(c.number);
                  setName("TEST CARD");
                  setExp("12/30");
                  setCvc("123");
                }}
              >
                <span className="font-mono">{c.number}</span>
                <span className="text-ink-2">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}

function PaidScreen({ order }: { order: Order }) {
  return (
    <div className="mx-auto max-w-xl py-6 text-center">
      <m.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }} className="mx-auto grid size-24 place-items-center rounded-full bg-[#e9f6ee]">
        <m.span initial={{ rotate: -30 }} animate={{ rotate: 0 }} transition={{ delay: 0.15, type: "spring" }}>
          <CircleCheck className="size-14 text-success" strokeWidth={1.6} aria-hidden />
        </m.span>
      </m.div>
      <m.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6, ease: EASE }} className="mt-6 text-[34px] font-semibold tracking-[-0.03em] md:text-[44px]">
        ขอบคุณสำหรับคำสั่งซื้อ
      </m.h1>
      <p className="mt-2 text-ink-2">
        ชำระเงินเรียบร้อย คำสั่งซื้อ <span className="font-semibold text-ink">{order.order_no}</span> กำลังเตรียมจัดส่ง
      </p>
      <div className="mt-6 rounded-[24px] bg-canvas-alt p-5 text-left">
        <ul className="space-y-2 text-sm">
          {order.items.map((i) => (
            <li key={i.variant_id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {i.product_name} <span className="text-ink-2">× {i.qty}</span>
              </span>
              <span className="tabular-nums">{formatBaht(i.line_total_satang)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-hairline-soft pt-3 font-semibold">
          <span>ยอดชำระ</span>
          <span className="tabular-nums">{formatBaht(order.totals.grand_total_satang)}</span>
        </div>
        {order.totals.savings_satang > 0 ? <p className="mt-2 text-sm font-semibold text-success">คุณประหยัดไป {formatBaht(order.totals.savings_satang)}</p> : null}
      </div>
      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
        <Link href={`/account/orders/${encodeURIComponent(order.order_no)}`} className="btn btn-primary">
          ติดตามคำสั่งซื้อ
        </Link>
        <Link href="/" className="btn btn-secondary">
          ช้อปต่อ
        </Link>
      </div>
    </div>
  );
}

/** domMax (drag / layout) is loaded lazily for this subtree only. */
export function PayView() {
  return (
    <MaxMotion>
      <PayViewInner />
    </MaxMotion>
  );
}
