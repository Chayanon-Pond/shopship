import { clsx } from "clsx";
import { ArrowRight, Truck } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { promoCopy } from "@/lib/site";
import { GrowBar, Reveal } from "@/components/ui/motion";

// Static home sections rendered on the server (no client JS of their own; Reveal / GrowBar are small client islands).

/** Trade-discount explainer strip. */
export function TradeStrip({ example }: { example?: { name: string; slug: string } }) {
  const steps = [
    { qty: "1–4 ชิ้น", off: "ราคาปกติ", w: "w-[38%]" },
    { qty: "5 ชิ้นขึ้นไป", off: "ลด 5%", w: "w-[66%]" },
    { qty: "10 ชิ้นขึ้นไป", off: "ลด 10%", w: "w-full" },
  ];
  return (
    <section id="trade" aria-labelledby="trade-title" className="cv-section container-page py-6">
      <div className="grid overflow-hidden rounded-[28px] bg-ink text-white md:grid-cols-2">
        <div className="p-8 md:p-12">
          <p className="text-sm font-semibold text-[#2997ff]">{promoCopy.trade.eyebrow}</p>
          <h2 id="trade-title" className="mt-1 text-[32px] font-semibold leading-tight tracking-[-0.025em] md:text-[44px]">
            {promoCopy.trade.title}
          </h2>
          <p className="mt-2 text-xl font-semibold text-white/90">{promoCopy.trade.tiers.join(" · ")}</p>
          <p className="mt-3 max-w-md text-white/70">{promoCopy.trade.body}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={example ? `/p/${example.slug}` : "/search?on_sale=true"} className="btn bg-white text-ink hover:bg-white/90">
              ดูสินค้าราคาส่ง
            </Link>
            <Link href="/promotions#trade" className="btn btn-link text-[#2997ff]">
              วิธีรับราคาส่ง <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
        <div className="flex flex-col justify-center gap-4 p-8 pt-0 md:p-12">
          {steps.map((s, i) => (
            <Reveal key={s.qty} delay={i * 0.12}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-white/70">{s.qty}</span>
                <span className={clsx("font-semibold", i ? "text-[#30d158]" : "text-white/70")}>{s.off}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-pill bg-white/10">
                {/* grows once in view: same IntersectionObserver + CSS transition as the flash-sale sold bar */}
                <GrowBar className={clsx("h-full rounded-pill", s.w, i ? "bg-gradient-to-r from-[#2997ff] to-[#30d158]" : "bg-white/30")} delay={0.2 + i * 0.15} />
              </div>
            </Reveal>
          ))}
          <p className="text-xs text-white/50">ส่วนลดคำนวณอัตโนมัติในตะกร้า ตามจำนวนต่อรายการสินค้า</p>
        </div>
      </div>
    </section>
  );
}

export function FreeShipBanner() {
  return (
    <section className="cv-section container-page py-6" aria-label="ส่งฟรี">
      <Reveal>
        <div className="flex flex-col items-start gap-4 rounded-[28px] bg-[#e8f2fc] p-8 md:flex-row md:items-center md:justify-between md:p-10">
          <div className="flex items-center gap-4">
            {/* CSS keyframes (compositor), not a JS-driven infinite motion loop that runs a rAF every frame */}
            <span className="truck-nudge grid size-14 shrink-0 place-items-center rounded-full bg-white text-accent">
              <Truck className="size-7" aria-hidden />
            </span>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-[28px]">{promoCopy.freeShipping.title}</h2>
              <p className="text-ink-2">{promoCopy.freeShipping.body}</p>
            </div>
          </div>
          <Link href="/cart" className="btn btn-primary">
            ดูตะกร้าของฉัน
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
