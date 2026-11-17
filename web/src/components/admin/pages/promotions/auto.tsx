"use client";

import { Gift, Plus, ShoppingCart, Truck } from "lucide-react";
import { listCustomerGroups, listPromotions } from "@/lib/api/admin";
import { useApi } from "@/lib/admin/hooks";
import { errorMessage } from "../../overlay";
import { useSession } from "../../session";
import { Card, ErrorState, LinkButton } from "../../ui";
import { EmptyPromos, PromoTable } from "./shared";

const SECTIONS = [
  { layer: 3, title: "ช้อปครบ X ลด Y", icon: ShoppingCart, body: "ส่วนลดทั้งตะกร้าอัตโนมัติ เลือกโปรที่คุ้มที่สุดให้ลูกค้า 1 โปร (ไม่ต้องใช้โค้ด)", href: "/admin/promotions/new?kind=cart_amount" },
  { layer: 2, title: "ซื้อ N แถม M", icon: Gift, body: "ต่อรายการสินค้า ชิ้นที่ถูกที่สุดเป็นของแถม ไม่ร่วมกับราคา Flash Sale", href: "/admin/promotions/new?kind=buy_x_get_y" },
  { layer: 5, title: "ส่งฟรีเมื่อครบยอด", icon: Truck, body: "ใช้ได้ 1 กฎต่อออเดอร์ ถ้าลูกค้าใส่โค้ดส่งฟรีด้วย ระบบใช้อันเดียว", href: "/admin/promotions/new?kind=free_shipping" },
] as const;

export function AutoTab() {
  const { can } = useSession();
  const res = useApi(() => listPromotions({ layer: undefined, per_page: 100 }), "auto");
  const groups = useApi(listCustomerGroups, "groups", can("customers:read"));
  if (res.error) return <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />;
  return (
    <div className="flex flex-col gap-4">
      {SECTIONS.map((s) => (
        <Card
          key={s.layer}
          pad={false}
          title={
            <span className="flex items-center gap-2">
              <s.icon className="size-4 text-ink-2" aria-hidden />
              {s.title}
            </span>
          }
          actions={can("promotions:write") ? <LinkButton size="sm" variant="outline" icon={Plus} href={s.href}>สร้าง</LinkButton> : null}
        >
          <p className="border-b border-hairline-soft px-4 py-2 text-[13px] text-ink-2">{s.body}</p>
          <PromoTable rows={res.data?.data.filter((p) => p.layer === s.layer)} loading={res.loading} groups={groups.data?.data} onChanged={res.reload} empty={<EmptyPromos title="ยังไม่มีโปรประเภทนี้" />} />
        </Card>
      ))}
    </div>
  );
}
