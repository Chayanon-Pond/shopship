"use client";

import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { listCustomerGroups, listPromotions } from "@/lib/api/admin";
import { useApi, useDebounced } from "@/lib/admin/hooks";
import { errorMessage } from "../../overlay";
import { useSession } from "../../session";
import { Card, ErrorState, Input, LinkButton, Segmented } from "../../ui";
import { EmptyPromos, PromoTable } from "./shared";

export function CouponsTab() {
  const { can } = useSession();
  const [state, setState] = useState<"" | "running" | "scheduled" | "ended" | "draft,paused">("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const query = { layer: 4, state: state || undefined, q: dq || undefined, per_page: 100 };
  const res = useApi(() => listPromotions(query), JSON.stringify(query));
  const groups = useApi(listCustomerGroups, "groups", can("customers:read"));
  return (
    <Card pad={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline-soft p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรือโค้ด" className="pl-9" aria-label="ค้นหาโค้ด" />
        </div>
        <Segmented
          value={state}
          onChange={setState}
          options={[
            { value: "", label: "ทั้งหมด" },
            { value: "running", label: "ใช้งาน" },
            { value: "scheduled", label: "ตั้งเวลา" },
            { value: "draft,paused", label: "ร่าง/หยุด" },
            { value: "ended", label: "หมดอายุ" },
          ]}
        />
        {can("promotions:write") ? (
          <LinkButton href="/admin/promotions/new?mode=code" variant="primary" icon={Plus}>
            สร้างโค้ด
          </LinkButton>
        ) : null}
      </div>
      {res.error ? (
        <ErrorState message={errorMessage(res.error)} onRetry={res.reload} />
      ) : (
        <PromoTable
          rows={res.data?.data}
          loading={res.loading}
          groups={groups.data?.data}
          onChanged={res.reload}
          showCodes
          empty={<EmptyPromos title="ยังไม่มีโค้ดส่วนลด" body="สร้างโค้ดลด % / ลดบาท / ส่งฟรี พร้อมเงื่อนไขยอดขั้นต่ำและจำนวนสิทธิ์" />}
        />
      )}
    </Card>
  );
}
