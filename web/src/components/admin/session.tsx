"use client";

import { createContext, useContext } from "react";
import type { Me, Perm } from "@/lib/api/types";

/** Signed-in staff member. UI hides by perms; the API is the real check. */
export type AdminSession = { me: Me; can: (p: Perm) => boolean; logout: () => void };
export const SessionCtx = createContext<AdminSession | null>(null);
export function useSession(): AdminSession {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("useSession outside ConsoleShell");
  return s;
}
export function useCan() {
  return useSession().can;
}
/** Render children only when the user holds `perm`. */
export function Can({ perm, children, fallback = null }: { perm: Perm; children: React.ReactNode; fallback?: React.ReactNode }) {
  return useSession().can(perm) ? <>{children}</> : <>{fallback}</>;
}
