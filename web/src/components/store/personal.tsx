"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as api from "@/lib/api/storefront";
import type { Offer } from "@/lib/api/types";
import { useSession } from "./session";
import { useToast } from "./toast";

/* ------------------------------------------------------------------ offers (/offers, no-store, batched) */
type OffersCtx = { get: (id: number) => Offer | undefined; request: (ids: number[]) => void; version: number };
const OffersContext = createContext<OffersCtx | null>(null);

/**
 * Personal (member / trade / flash) unit prices. Components call `useOffers(ids)`;
 * ids requested in the same tick are batched into one GET /offers (≤ 100 ids).
 * The cache is dropped whenever the signed-in user changes.
 */
export function OffersProvider({ children }: { children: React.ReactNode }) {
  const { me, ready } = useSession();
  const cache = useRef(new Map<number, Offer | null>());
  const pending = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);
  const userKey = useRef<string>("");

  const flush = useCallback(async () => {
    timer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        const list = await api.getOffers(chunk);
        const byId = new Map(list.map((o) => [o.variant_id, o]));
        for (const id of chunk) cache.current.set(id, byId.get(id) ?? null);
      } catch {
        for (const id of chunk) cache.current.set(id, null);
      }
    }
    setVersion((v) => v + 1);
  }, []);

  const request = useCallback(
    (ids: number[]) => {
      if (!ready) return;
      let added = false;
      for (const id of ids) {
        if (!id || cache.current.has(id) || pending.current.has(id)) continue;
        pending.current.add(id);
        added = true;
      }
      if (added && !timer.current) timer.current = setTimeout(flush, 0);
    },
    [ready, flush],
  );

  useEffect(() => {
    const k = me ? `u${me.id}` : "guest";
    if (userKey.current && userKey.current !== k) {
      cache.current.clear();
      setVersion((v) => v + 1);
    }
    userKey.current = k;
  }, [me]);

  const get = useCallback((id: number) => cache.current.get(id) ?? undefined, []);
  const value = useMemo(() => ({ get, request, version }), [get, request, version]);
  return <OffersContext.Provider value={value}>{children}</OffersContext.Provider>;
}

export function useOffers(ids: number[]) {
  const ctx = useContext(OffersContext);
  if (!ctx) throw new Error("useOffers outside OffersProvider");
  const key = ids.join(",");
  const { request, get, version } = ctx;
  useEffect(() => {
    request(key ? key.split(",").map(Number) : []);
  }, [key, request, version]);
  return useMemo(() => {
    void version;
    const out = new Map<number, Offer>();
    for (const id of key ? key.split(",").map(Number) : []) {
      const o = get(id);
      if (o) out.set(id, o);
    }
    return out;
  }, [key, get, version]);
}

/* ------------------------------------------------------------------ wishlist */
const EMPTY = new Set<number>();
type WishCtx = { has: (productId: number) => boolean; toggle: (productId: number, name?: string) => Promise<void>; count: number };
const WishContext = createContext<WishCtx | null>(null);

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [ids, setIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    if (!me) return;
    api
      .getWishlist()
      .then((r) => alive && setIds(new Set(r.data.map((p) => p.id))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [me]);

  const toggle = useCallback(
    async (productId: number, name?: string) => {
      if (!me) {
        toast({ tone: "error", text: "เข้าสู่ระบบเพื่อบันทึกรายการโปรด" });
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      const on = ids.has(productId);
      setIds((s) => {
        const n = new Set(s);
        if (on) n.delete(productId);
        else n.add(productId);
        return n;
      });
      try {
        if (on) await api.removeWishlist(productId);
        else await api.addWishlist(productId);
        toast({ tone: "ok", text: on ? "นำออกจากรายการโปรดแล้ว" : `บันทึก${name ? ` “${name}”` : ""} ในรายการโปรดแล้ว` });
      } catch {
        setIds((s) => {
          const n = new Set(s);
          if (on) n.add(productId);
          else n.delete(productId);
          return n;
        });
        toast({ tone: "error", text: "บันทึกรายการโปรดไม่สำเร็จ" });
      }
    },
    [me, ids, toast, router],
  );

  const live = me ? ids : EMPTY;
  const value = useMemo(() => ({ has: (id: number) => live.has(id), toggle, count: live.size }), [live, toggle]);
  return <WishContext.Provider value={value}>{children}</WishContext.Provider>;
}

export function useWishlist() {
  const v = useContext(WishContext);
  if (!v) throw new Error("useWishlist outside WishlistProvider");
  return v;
}
