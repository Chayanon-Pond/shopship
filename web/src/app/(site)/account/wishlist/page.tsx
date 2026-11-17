import type { Metadata } from "next";
import { AccountShell, WishlistView } from "@/components/account/views";

export const metadata: Metadata = { title: "รายการโปรด" };

export default function WishlistPage() {
  return (
    <AccountShell title="รายการโปรด">
      <WishlistView />
    </AccountShell>
  );
}
