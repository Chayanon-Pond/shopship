"use client";

import { Info, Store, Truck } from "lucide-react";
import Link from "next/link";
import { formatBaht } from "@/lib/money";
import { USE_MOCKS } from "@/lib/api/client";
import { ROLE_LABEL } from "@/lib/admin/format";
import { useSession } from "../session";
import { Badge, Card, PageHeader } from "../ui";

/** Wave-1 placeholder: shop info and shipping are read-only (configured by env on the API). */
export function SettingsPage() {
  const { me } = useSession();
  const rows: [string, string][] = [
    ["ชื่อร้าน", "ShopShip"],
    ["อีเมลติดต่อ", "hello@shopship.co"],
    ["สกุลเงิน", "บาท (THB) · เก็บเป็นสตางค์"],
    ["เขตเวลา", "Asia/Bangkok (UTC+7)"],
    ["ภาษา", "ไทย"],
  ];
  return (
    <div>
      <PageHeader title="ตั้งค่า" subtitle="อ่านอย่างเดียวในเวอร์ชันนี้" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Store className="size-4 text-ink-2" aria-hidden />ข้อมูลร้าน</span>}>
          <dl className="divide-y divide-hairline-soft text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2">
                <dt className="text-ink-2">{k}</dt>
                <dd className="text-right text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Truck className="size-4 text-ink-2" aria-hidden />การจัดส่ง</span>}>
          <dl className="divide-y divide-hairline-soft text-sm">
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">ผู้ให้บริการ</dt>
              <dd>
                Flash Express <Badge tone="orange">จำลอง</Badge>
              </dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">ค่าส่งเหมาจ่าย (ทั่วประเทศ)</dt>
              <dd className="font-medium tabular-nums">{formatBaht(4000)}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">ระยะเวลาส่ง</dt>
              <dd>1–3 วัน (ต่างจังหวัดห่างไกล 2–5 วัน)</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-2">ส่งฟรี</dt>
              <dd>
                ตั้งค่าที่ <Link className="text-link hover:underline" href="/admin/promotions?tab=auto">โปรโมชัน › โปรอัตโนมัติ</Link>
              </dd>
            </div>
          </dl>
        </Card>
        <Card title="การชำระเงิน">
          <p className="text-sm text-ink">PromptPay และบัตร ผ่านผู้ให้บริการ (ตอนนี้เป็นโหมดจำลอง ไม่มีการตัดเงินจริง)</p>
        </Card>
        <Card title="บัญชีของคุณ">
          <p className="text-sm">
            {me.email} · <Badge tone="blue">{ROLE_LABEL[me.role]}</Badge>
          </p>
          <p className="mt-2 text-xs text-ink-2">สิทธิ์: {me.perms.join(", ")}</p>
        </Card>
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-2">
        <Info className="size-3.5" aria-hidden /> ค่าเหล่านี้ตั้งจากตัวแปรระบบของเซิร์ฟเวอร์ {USE_MOCKS ? "(กำลังใช้ข้อมูลจำลอง)" : ""}
      </p>
    </div>
  );
}
