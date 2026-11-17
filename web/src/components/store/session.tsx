"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api/storefront";
import type { Me } from "@/lib/api/types";

type SessionCtx = {
  me: Me | null;
  /** false until the first /auth/me answered (avoid flashing guest UI). */
  ready: boolean;
  signIn: (email: string, password: string) => Promise<Me>;
  signUp: (b: Parameters<typeof api.register>[0]) => Promise<Me>;
  signOut: () => Promise<void>;
  setMe: (m: Me | null) => void;
  refresh: () => Promise<void>;
};
const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.getMe());
    } catch {
      setMe(null); // API down / not implemented yet → behave as guest
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    api
      .getMe()
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe(null))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const m = await api.login(email, password);
    setMe(m);
    return m;
  }, []);
  const signUp = useCallback(async (b: Parameters<typeof api.register>[0]) => {
    const m = await api.register(b);
    setMe(m);
    return m;
  }, []);
  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    setMe(null);
  }, []);

  const value = useMemo(() => ({ me, ready, signIn, signUp, signOut, setMe, refresh }), [me, ready, signIn, signUp, signOut, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** Client-side login gate for personal pages: redirects guests to /login?next=… */
export function useRequireLogin() {
  const s = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (s.ready && !s.me) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [s.ready, s.me, router, path]);
  return s;
}
