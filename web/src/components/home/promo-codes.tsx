import { Ticket } from "lucide-react";
import type { PromoCode } from "@/lib/api/types";
import { CopyCode, Reveal } from "@/components/ui/motion";
import { thDate } from "@/lib/intl";

const fmt = (iso: string) =>
  thDate(iso);

/** Coupon "tickets" with copy buttons. Server-renderable. */
export function PromoCodes({ codes, accent = "#0071e3" }: { codes: PromoCode[]; accent?: string }) {
  if (!codes.length)
    return <p className="rounded-tile bg-canvas-alt p-8 text-center text-ink-2">ยังไม่มีโค้ดส่วนลดสาธารณะในตอนนี้ — ส่วนลดอัตโนมัติจะคำนวณให้ในตะกร้า</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {codes.map((c, i) => (
        <Reveal as="li" key={c.code} delay={i * 0.07}>
          <div className="relative flex h-full overflow-hidden rounded-tile bg-white shadow-[0_0_0_1px_var(--hairline-soft)]">
            <div className="flex w-16 shrink-0 items-center justify-center" style={{ background: accent }}>
              <Ticket className="size-6 -rotate-12 text-white" aria-hidden />
            </div>
            {/* ticket notches */}
            <span className="absolute left-16 top-0 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-canvas-alt" aria-hidden />
            <span className="absolute bottom-0 left-16 size-4 -translate-x-1/2 translate-y-1/2 rounded-full bg-canvas-alt" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-3 border-l border-dashed border-hairline p-5">
              <div>
                <p className="text-lg font-semibold leading-snug tracking-tight">{c.label}</p>
                {c.description ? <p className="mt-0.5 text-sm text-ink-2">{c.description}</p> : null}
                {c.ends_at ? <p className="mt-1 text-xs text-ink-3">ใช้ได้ถึง {fmt(c.ends_at)}</p> : null}
              </div>
              <CopyCode code={c.code} className="self-start" />
            </div>
          </div>
        </Reveal>
      ))}
    </ul>
  );
}
