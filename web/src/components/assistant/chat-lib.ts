/**
 * Pure helpers for the shop assistant widget (no React, no "@/" runtime imports,
 * so `node --test` can load them). Wire shapes: docs/API.md §14.
 */
import type { AssistantAction, AssistantCard, AssistantMessage } from "@/lib/api/types";

export type ChatItem = {
  id: number;
  role: "user" | "assistant";
  text: string;
  products?: AssistantCard[];
  actions?: AssistantAction[];
  /** local-only bubble (welcome / error): never sent back as history */
  local?: boolean;
};

export const MAX_INPUT = 500;
export const MAX_HISTORY = 10;

export const WELCOME =
  "สวัสดีค่ะ ผู้ช่วย ShopShip ช่วยหาสินค้า เช็กโปรโมชัน ค่าส่ง และสถานะคำสั่งซื้อได้ค่ะ พิมพ์ถามได้เลย";
export const DEFAULT_CHIPS = ["มีโปรอะไรบ้าง", "แนะนำสินค้าขายดี", "ค่าส่งเท่าไหร่", "เช็กสถานะคำสั่งซื้อ"];
export const DISCLOSURE = "ผู้ช่วยอัตโนมัติ อาจตอบผิดพลาดได้";

/** Last MAX_HISTORY server-visible turns, oldest first, starting with a user turn. */
export function toHistory(items: ChatItem[]): AssistantMessage[] {
  const out = items.filter((m) => !m.local && m.text.trim() !== "").map((m) => ({ role: m.role, content: m.text }));
  let h = out.slice(-MAX_HISTORY);
  while (h.length > 1 && h[0].role !== "user") h = h.slice(1);
  return h;
}

/** /p/[slug] -> slug (page context for "ตัวนี้…"). */
export function productSlug(path: string): string | undefined {
  const m = /^\/p\/([^/?#]+)/.exec(path);
  return m ? decodeURIComponent(m[1]) : undefined;
}

export type Placement = { hidden: boolean; lift: "none" | "always" | "below-lg" };

/** Where the launcher sits: hidden on checkout, lifted above the sticky buy/checkout bars. */
export function placementFor(path: string): Placement {
  if (/^\/checkout(\/|$)/.test(path)) return { hidden: true, lift: "none" };
  if (/^\/p\//.test(path)) return { hidden: false, lift: "always" };
  if (/^\/cart$/.test(path)) return { hidden: false, lift: "below-lg" };
  return { hidden: false, lift: "none" };
}

/** Links leaving the storefront (LINE, mailto) open outside the SPA. */
export function isExternal(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

/** Only same-site paths and the hand-off schemes are rendered as links. */
export function safeHref(href: string): string | null {
  if (/^\/(?!\/)/.test(href)) return href;
  if (/^(https:|mailto:|tel:)/i.test(href)) return href;
  return null;
}

export function clampInput(s: string): string {
  return Array.from(s).slice(0, MAX_INPUT).join("");
}
