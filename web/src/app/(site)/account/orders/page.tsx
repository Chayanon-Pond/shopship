import type { Metadata } from "next";
import { AccountShell, OrdersList } from "@/components/account/views";

export const metadata: Metadata = { title: "คำสั่งซื้อของฉัน" };

export default function OrdersPage() {
  return (
    <AccountShell title="คำสั่งซื้อของฉัน">
      <OrdersList />
    </AccountShell>
  );
}
