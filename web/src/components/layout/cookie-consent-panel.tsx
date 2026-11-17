"use client";

import { clsx } from "clsx";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { useState } from "react";
import { useConsent } from "@/components/store/consent";
import { Sheet } from "@/components/ui/motion";

// Accept and reject get the exact same look (PDPA: refusing must be as easy as accepting).
const choiceBtn = "btn min-h-11 flex-1 cursor-pointer bg-ink px-5 text-[15px] text-white hover:bg-black sm:flex-none";

function Switch({ checked, onChange, disabled, label, id }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string; id: string }) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={clsx(
        "relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer items-center rounded-pill p-[2px] transition-colors duration-200 disabled:cursor-not-allowed",
        checked ? "bg-success" : "bg-hairline",
        disabled && "opacity-60",
      )}
    >
      <span className={clsx("block size-[27px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2)] transition-transform duration-200", checked && "translate-x-5")} />
    </button>
  );
}

const CATS = [
  { key: "necessary", title: "คุกกี้ที่จำเป็น", text: "ให้ร้านทำงานได้: การเข้าสู่ระบบ ตะกร้าสินค้า ความปลอดภัย และจำตัวเลือกคุกกี้ของคุณ ปิดไม่ได้" },
  { key: "analytics", title: "คุกกี้วิเคราะห์", text: "นับผู้เข้าชมและดูว่าหน้าไหนใช้งานยากหรือช้า เพื่อปรับปรุงร้าน (ข้อมูลแบบรวม)" },
  { key: "marketing", title: "คุกกี้การตลาด", text: "วัดผลโฆษณาและแสดงโปรโมชันที่ตรงความสนใจบนเว็บไซต์หรือแอปอื่น" },
] as const;

function Settings() {
  const c = useConsent();
  const [analytics, setAnalytics] = useState(c.consent?.analytics ?? false);
  const [marketing, setMarketing] = useState(c.consent?.marketing ?? false);
  const val = { necessary: true, analytics, marketing };
  const set = { analytics: setAnalytics, marketing: setMarketing } as const;
  return (
    <Sheet open={c.settingsOpen} onClose={c.closeSettings} title="ตั้งค่าคุกกี้" side="bottom">
      <p className="text-sm text-ink-2">
        เลือกได้ว่าจะอนุญาตคุกกี้ประเภทใด เปลี่ยนใจได้ทุกเมื่อจาก “ตั้งค่าคุกกี้” ท้ายเว็บไซต์ อ่านรายละเอียดใน{" "}
        <Link href="/legal/cookies" className="text-link underline underline-offset-2 hover:decoration-2" onClick={c.closeSettings}>
          นโยบายคุกกี้
        </Link>
      </p>
      <ul className="mt-4 divide-y divide-hairline-soft">
        {CATS.map((cat) => (
          <li key={cat.key} className="flex items-start gap-4 py-4">
            <label htmlFor={`consent-${cat.key}`} className="min-w-0 flex-1">
              <span className="block font-semibold">{cat.title}</span>
              <span className="mt-0.5 block text-sm text-ink-2">{cat.text}</span>
              {cat.key === "necessary" ? <span className="mt-1 block text-xs font-medium text-success">เปิดใช้งานตลอด</span> : null}
            </label>
            <Switch
              id={`consent-${cat.key}`}
              label={cat.title}
              checked={val[cat.key]}
              disabled={cat.key === "necessary"}
              onChange={cat.key === "necessary" ? undefined : set[cat.key]}
            />
          </li>
        ))}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-primary col-span-2 cursor-pointer" onClick={() => c.save({ analytics, marketing })}>
          บันทึกการตั้งค่า
        </button>
        <button type="button" className="btn btn-secondary cursor-pointer whitespace-nowrap px-3" onClick={c.acceptAll}>
          ยอมรับทั้งหมด
        </button>
        <button type="button" className="btn btn-secondary cursor-pointer whitespace-nowrap px-3" onClick={c.rejectAll}>
          ปฏิเสธที่ไม่จำเป็น
        </button>
      </div>
    </Sheet>
  );
}

/** Bottom bar (first visit) + settings sheet. Floats above the mobile tab bar (`--bottom-nav-h`, globals.css). */
export function ConsentPanel() {
  const c = useConsent();
  return (
    <>
      {!c.decided && !c.settingsOpen ? (
        <section
          aria-label="การใช้คุกกี้"
          className="consent-in fixed inset-x-0 z-[60] px-3 sm:px-4"
          style={{ bottom: "calc(var(--bottom-nav-h) + max(12px, env(safe-area-inset-bottom)))" }}
        >
          <div className="mx-auto flex max-w-[980px] flex-col gap-3 rounded-[22px] bg-white/95 p-4 shadow-pop ring-1 ring-black/5 backdrop-blur-xl sm:p-5 md:flex-row md:items-center md:gap-6">
            <p className="text-[13px] leading-relaxed text-ink-2 md:flex-1">
              <span className="font-semibold text-ink">ShopShip ใช้คุกกี้</span> ที่จำเป็นเพื่อให้ร้านทำงาน และขอความยินยอมใช้คุกกี้วิเคราะห์และการตลาด
              อ่าน{" "}
              <Link href="/legal/privacy" className="text-link underline underline-offset-2 hover:decoration-2">
                นโยบายความเป็นส่วนตัว
              </Link>{" "}
              และ{" "}
              <Link href="/legal/cookies" className="text-link underline underline-offset-2 hover:decoration-2">
                นโยบายคุกกี้
              </Link>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={choiceBtn} onClick={c.acceptAll}>
                ยอมรับทั้งหมด
              </button>
              <button type="button" className={choiceBtn} onClick={c.rejectAll}>
                ปฏิเสธที่ไม่จำเป็น
              </button>
              <button type="button" className="btn btn-link min-h-11 w-full cursor-pointer px-3 text-[15px] sm:w-auto" onClick={c.openSettings}>
                ตั้งค่า
              </button>
            </div>
          </div>
        </section>
      ) : null}
      <Settings />
    </>
  );
}
