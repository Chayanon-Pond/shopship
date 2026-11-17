import type { Metadata } from "next";
import { AccountShell, AddressBook } from "@/components/account/views";

export const metadata: Metadata = { title: "สมุดที่อยู่" };

export default function AddressesPage() {
  return (
    <AccountShell title="สมุดที่อยู่">
      <AddressBook />
    </AccountShell>
  );
}
