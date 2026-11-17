"use client";

import clsx from "clsx";
import { CalendarRange, FlaskConical, Handshake, Sparkles, TicketPercent, Zap } from "lucide-react";
import { useUrlState } from "@/lib/admin/hooks";
import { PageHeader } from "../../ui";
import { AutoTab } from "./auto";
import { CampaignsTab } from "./campaigns";
import { CouponsTab } from "./coupons";
import { FlashTab } from "./flash";
import { SimulatorTab } from "./simulator";
import { TradeTab } from "./trade";

export const PROMO_TABS = [
  { id: "coupons", label: "คูปอง/โค้ด", icon: TicketPercent },
  { id: "campaigns", label: "แคมเปญตามฤดูกาล", icon: CalendarRange },
  { id: "trade", label: "ราคาส่ง/สมาชิก", icon: Handshake },
  { id: "auto", label: "โปรอัตโนมัติ", icon: Sparkles },
  { id: "flash", label: "Flash Sale", icon: Zap },
  { id: "simulator", label: "จำลองตะกร้า", icon: FlaskConical },
] as const;
export type PromoTab = (typeof PROMO_TABS)[number]["id"];

export function PromotionsHub({ defaultTab = "coupons" }: { defaultTab?: PromoTab }) {
  const { values, set } = useUrlState(["tab"] as const);
  const tab = (PROMO_TABS.some((t) => t.id === values.tab) ? values.tab : defaultTab) as PromoTab;
  return (
    <div>
      <PageHeader title="โปรโมชัน" subtitle="ทุกส่วนลดของร้านในที่เดียว · ราคาคำนวณ 5 ชั้น: ราคาต่อชิ้น → โปรรายการ → ตะกร้าอัตโนมัติ → โค้ด → ค่าส่ง" />
      <div role="tablist" aria-label="ประเภทโปรโมชัน" className="no-scrollbar -mx-3 mb-5 flex gap-1 overflow-x-auto border-b border-hairline-soft px-3 sm:mx-0 sm:px-0">
        {PROMO_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => set({ tab: t.id })}
            className={clsx(
              "relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-sm transition-colors",
              tab === t.id ? "font-medium text-ink after:absolute after:inset-x-2 after:bottom-[-1px] after:h-[2px] after:rounded-full after:bg-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            <t.icon className={clsx("size-4", t.id === "simulator" && tab !== t.id && "text-link")} aria-hidden />
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" key={tab} className="animate-[fade-in_200ms_ease-out]">
        {tab === "coupons" ? <CouponsTab /> : tab === "campaigns" ? <CampaignsTab /> : tab === "trade" ? <TradeTab /> : tab === "auto" ? <AutoTab /> : tab === "flash" ? <FlashTab /> : <SimulatorTab />}
      </div>
    </div>
  );
}
