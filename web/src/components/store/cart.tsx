"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import * as api from "@/lib/api/storefront";
import { prefersReducedMotion } from "@/components/ui/fx";
import type { Cart } from "@/lib/api/types";
import { useSession } from "./session";
import { useToast } from "./toast";

type FlyFrom = { rect: DOMRect; image?: string | null };

type CartCtx = {
  cart: Cart | null;
  count: number;
  ready: boolean;
  busy: boolean;
  /** increments after every successful add → badge bounce */
  bump: number;
  add: (variantId: number, qty: number, from?: FlyFrom, name?: string) => Promise<boolean>;
  setQty: (variantId: number, qty: number) => Promise<void>;
  remove: (variantId: number) => Promise<void>;
  applyCode: (code: string) => Promise<Cart | null>;
  removeCode: () => Promise<void>;
  refresh: () => Promise<void>;
  setCart: (c: Cart) => void;
  registerTarget: (el: HTMLElement | null) => void;
};
const Ctx = createContext<CartCtx | null>(null);
// `add` alone, stable for the provider's lifetime: product cards use it without re-rendering when the cart changes.
const AddCtx = createContext<CartCtx["add"] | null>(null);

export function errorText(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "not_implemented") return "ระบบนี้ยังไม่เปิดให้บริการ";
    return e.message || "เกิดข้อผิดพลาด กรุณาลองใหม่";
  }
  return "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่";
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { me, ready: sessionReady } = useSession();
  const toast = useToast();
  const [cart, setCart] = useState<Cart | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bump, setBump] = useState(0);
  const targets = useRef(new Set<HTMLElement>());
  const layer = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setCart(await api.getCart());
    } catch {
      /* guest without API: keep empty */
    } finally {
      setReady(true);
    }
  }, []);
  // re-read after login/logout (guest cart merges server-side)
  useEffect(() => {
    if (!sessionReady) return;
    let alive = true;
    api
      .getCart()
      .then((c) => alive && setCart(c))
      .catch(() => {})
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [sessionReady, me?.id]);

  const registerTarget = useCallback((el: HTMLElement | null) => {
    if (el) targets.current.add(el);
  }, []);

  /** Fly-to-cart: a thumbnail arcs from the product to the visible cart icon (Web Animations API, no motion runtime). */
  const launch = useCallback((from?: FlyFrom) => {
    const host = layer.current;
    if (!from || !host || prefersReducedMotion()) return;
    const visible = [...targets.current].filter((el) => el.isConnected).find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
    });
    if (!visible) return;
    const to = visible.getBoundingClientRect();
    const size = 56;
    const sx = from.rect.left + from.rect.width / 2 - size / 2;
    const sy = from.rect.top + from.rect.height / 2 - size / 2;
    const ex = to.left + to.width / 2 - size / 2;
    const ey = to.top + to.height / 2 - size / 2;
    const peak = Math.min(sy, ey) - Math.max(80, Math.abs(ex - sx) * 0.25);
    const el = document.createElement("div");
    el.className = "absolute left-0 top-0 overflow-hidden rounded-[16px] bg-canvas-alt shadow-pop ring-2 ring-white";
    el.style.cssText = `width:${size}px;height:${size}px;will-change:transform`;
    if (from.image) {
      const img = document.createElement("img");
      img.src = from.image;
      img.alt = "";
      img.className = "size-full object-cover";
      el.appendChild(img);
    } else {
      el.innerHTML = '<span class="block size-full bg-accent"></span>';
    }
    host.appendChild(el);
    const a = el.animate(
      [
        { transform: `translate(${sx}px,${sy}px) scale(1.4) rotate(0deg)`, opacity: 0, offset: 0 },
        { transform: `translate(${sx + (ex - sx) * 0.45}px,${peak}px) scale(1) rotate(-8deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${ex}px,${ey}px) scale(0.3) rotate(0deg)`, opacity: 0.9, offset: 1 },
      ],
      { duration: 800, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" },
    );
    a.onfinish = a.oncancel = () => el.remove();
  }, []);

  const add = useCallback(
    async (variantId: number, qty: number, from?: FlyFrom, name?: string) => {
      launch(from);
      setBusy(true);
      try {
        const c = await api.addToCart(variantId, qty);
        setCart(c);
        setBump((b) => b + 1);
        toast({ tone: "ok", text: name ? `เพิ่ม “${name}” ลงตะกร้าแล้ว` : "เพิ่มลงตะกร้าแล้ว", action: { label: "ดูตะกร้า", href: "/cart" } });
        return true;
      } catch (e) {
        toast({ tone: "error", text: errorText(e) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [launch, toast],
  );
  const wrap = useCallback(
    async (fn: () => Promise<Cart>) => {
      setBusy(true);
      try {
        const c = await fn();
        setCart(c);
        return c;
      } catch (e) {
        toast({ tone: "error", text: errorText(e) });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  const setQty = useCallback(async (v: number, q: number) => void (await wrap(() => api.setCartQty(v, q))), [wrap]);
  const remove = useCallback(async (v: number) => void (await wrap(() => api.removeFromCart(v))), [wrap]);
  const applyCode = useCallback((code: string) => wrap(() => api.applyCoupon(code)), [wrap]);
  const removeCode = useCallback(async () => void (await wrap(() => api.removeCoupon())), [wrap]);

  const value = useMemo(
    () => ({
      cart,
      count: cart?.item_count ?? 0,
      ready,
      busy,
      bump,
      add,
      setQty,
      remove,
      applyCode,
      removeCode,
      refresh,
      setCart,
      registerTarget,
    }),
    [cart, ready, busy, bump, add, setQty, remove, applyCode, removeCode, refresh, registerTarget],
  );
  return (
    <Ctx.Provider value={value}>
      <AddCtx.Provider value={add}>{children}</AddCtx.Provider>
      <div ref={layer} className="pointer-events-none fixed inset-0 z-[70]" aria-hidden />
    </Ctx.Provider>
  );
}

export function useCart() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCart outside CartProvider");
  return v;
}

/** Just the stable `add` action (no re-render on cart changes). */
export function useCartAdd() {
  const v = useContext(AddCtx);
  if (!v) throw new Error("useCartAdd outside CartProvider");
  return v;
}
