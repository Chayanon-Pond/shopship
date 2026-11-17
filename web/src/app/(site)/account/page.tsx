import { AccountOverview, AccountShell } from "@/components/account/views";

export default function AccountPage() {
  return (
    <AccountShell title="บัญชีของฉัน">
      <AccountOverview />
    </AccountShell>
  );
}
