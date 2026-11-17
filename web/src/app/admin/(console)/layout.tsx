import { Suspense } from "react";
import { ConsoleShell, ShellSkeleton } from "@/components/admin/shell";

// Back-office chrome + session gate (client-side, no-store): 401 → /admin/login, customer → 403.
// Suspense: the shell reads the pathname (runtime URL data) — keeps dynamic routes prerenderable.
// Every console page is client-rendered behind the session gate (personal, no-store data), so
// the page segment is intentionally not in the prerendered shell: opt out of instant-nav validation.
export const instant = false;

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ConsoleShell>{children}</ConsoleShell>
    </Suspense>
  );
}
