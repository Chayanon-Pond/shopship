"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useCart } from "@/components/store/cart";
import { Img, Price } from "@/components/ui/primitives";
import { ApiError, send } from "@/lib/api/client";
import type { AssistantAction, AssistantCard, AssistantChatResponse } from "@/lib/api/types";
import {
  clampInput,
  DEFAULT_CHIPS,
  DISCLOSURE,
  isExternal,
  MAX_INPUT,
  safeHref,
  toHistory,
  WELCOME,
  type ChatItem,
} from "./chat-lib";
import type { ChatPanelProps } from "./chat-widget";

const STORE_KEY = "shopship_assistant_v1";
const welcome: ChatItem = { id: 0, role: "assistant", text: WELCOME, local: true };

type Saved = { items: ChatItem[]; chips: string[] };

function readSaved(): Saved {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (Array.isArray(s.items) && s.items.length > 0) return { items: s.items.slice(-40), chips: s.chips ?? DEFAULT_CHIPS };
    }
  } catch {
    /* private mode / corrupted: start fresh */
  }
  return { items: [welcome], chips: DEFAULT_CHIPS };
}

function isPhone() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

function errorReply(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "ส่งข้อความถี่เกินไป กรุณารอสักครู่แล้วลองใหม่ค่ะ";
    if (e.status === 422) return e.message || "ข้อความไม่ถูกต้อง กรุณาลองใหม่ค่ะ";
    if (e.code === "not_implemented") return "ผู้ช่วยยังไม่เปิดให้บริการในโหมดทดลองค่ะ";
  }
  return "เชื่อมต่อผู้ช่วยไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ";
}

/** Apple-style sheet: full screen on phones, floating panel on tablet/desktop. Loaded lazily by chat-widget.tsx. */
export function ChatPanel({ open, onClose, productSlug }: ChatPanelProps) {
  const [saved] = useState(readSaved);
  const [items, setItems] = useState<ChatItem[]>(saved.items);
  const [chips, setChips] = useState<string[]>(saved.chips);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextId = useRef(saved.items.reduce((m, i) => Math.max(m, i.id), 0) + 1);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ items: items.slice(-40), chips }));
    } catch {
      /* ignore */
    }
  }, [items, chips]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [items, busy]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    const root = document.documentElement;
    const prev = root.style.overflow;
    if (isPhone()) root.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      root.style.overflow = prev;
    };
  }, [open]);

  const ask = useCallback(
    (raw: string) => {
      const text = clampInput(raw.trim());
      if (!text || busy) return;
      const mine: ChatItem = { id: nextId.current++, role: "user", text };
      const next = [...items, mine];
      setItems(next);
      setInput("");
      setChips([]);
      setBusy(true);
      send<AssistantChatResponse>("POST", "/assistant/chat", {
        messages: toHistory(next),
        context: productSlug ? { product_slug: productSlug } : undefined,
      })
        .then((r) => {
          setItems((cur) => [...cur, { id: nextId.current++, role: "assistant", text: r.reply, products: r.products, actions: r.actions }]);
          setChips(r.suggestions.length ? r.suggestions : DEFAULT_CHIPS);
        })
        .catch((e: unknown) => {
          setItems((cur) => [...cur, { id: nextId.current++, role: "assistant", text: errorReply(e), local: true }]);
          setChips(DEFAULT_CHIPS);
        })
        .finally(() => setBusy(false));
    },
    [busy, items, productSlug],
  );

  const reset = () => {
    setItems([welcome]);
    setChips(DEFAULT_CHIPS);
  };
  const leave = () => {
    if (isPhone()) onClose();
  };

  return (
    <div
      id="assistant-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      inert={!open}
      aria-hidden={!open || undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className={clsx(
        "fixed inset-0 z-[80] flex flex-col overflow-hidden bg-canvas transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        "md:inset-auto md:bottom-6 md:right-6 md:h-[min(640px,calc(100dvh-6rem))] md:w-[400px] md:rounded-[28px] md:border md:border-hairline-soft md:shadow-[0_24px_64px_rgb(0_0_0/0.18)]",
        open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0",
        "starting:translate-y-6 starting:opacity-0",
      )}
    >
      {/* header */}
      <div className="flex items-center gap-3 border-b border-hairline-soft bg-canvas/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#0071e3,#7c3aed)] text-white" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <path d="M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1L5 9.5l5.1-1.9L12 2.5zM18.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[15px] font-semibold leading-tight">
            ผู้ช่วย ShopShip
          </h2>
          <p className="truncate text-xs text-ink-2">{DISCLOSURE}</p>
        </div>
        {items.length > 1 ? (
          <button type="button" onClick={reset} className="cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium text-link hover:bg-canvas-alt">
            เริ่มใหม่
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดผู้ช่วย"
          className="grid size-9 cursor-pointer place-items-center rounded-full bg-canvas-alt text-ink-2 transition hover:bg-hairline-soft hover:text-ink"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* conversation */}
      <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-label="บทสนทนากับผู้ช่วย" className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        {items.map((m) => (
          <Bubble key={m.id} item={m} onLeave={leave} />
        ))}
        {busy ? (
          <div className="flex">
            <div className="flex items-center gap-1 rounded-[20px] rounded-bl-md bg-canvas-alt px-4 py-3">
              <span className="sr-only">ผู้ช่วยกำลังพิมพ์</span>
              {[0, 150, 300].map((d) => (
                <span key={d} className="size-2 animate-bounce rounded-full bg-ink-3 motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} aria-hidden />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* quick replies + input */}
      <div className="border-t border-hairline-soft bg-canvas px-3 pt-2 pb-safe">
        {chips.length > 0 && !busy ? (
          <div className="-mx-3 mb-2 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]" role="group" aria-label="คำถามแนะนำ">
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => ask(c)}
                className="shrink-0 cursor-pointer rounded-full border border-hairline bg-canvas px-3.5 py-1.5 text-[13px] font-medium text-ink transition hover:border-accent hover:text-accent"
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <label htmlFor="assistant-input" className="sr-only">
            พิมพ์ข้อความถึงผู้ช่วย
          </label>
          <input
            id="assistant-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(clampInput(e.target.value))}
            maxLength={MAX_INPUT}
            enterKeyHint="send"
            autoComplete="off"
            placeholder="พิมพ์คำถาม เช่น มีเสื้อยืดสีขาวไหม"
            className="h-11 min-w-0 flex-1 rounded-full border border-hairline bg-surface-2 px-4 text-[16px] outline-none transition placeholder:text-ink-3 focus:border-accent focus:bg-canvas md:text-[15px]"
          />
          <button
            type="submit"
            disabled={busy || input.trim() === ""}
            aria-label="ส่งข้อความ"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-accent-contrast transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function Bubble({ item, onLeave }: { item: ChatItem; onLeave: () => void }) {
  const mine = item.role === "user";
  return (
    <div className={clsx("flex flex-col gap-2", mine ? "items-end" : "items-start")}>
      <p
        className={clsx(
          "max-w-[85%] whitespace-pre-line break-words rounded-[20px] px-4 py-2.5 text-[15px] leading-relaxed",
          mine ? "rounded-br-md bg-accent text-accent-contrast" : "rounded-bl-md bg-canvas-alt text-ink",
        )}
      >
        <span className="sr-only">{mine ? "คุณ: " : "ผู้ช่วย: "}</span>
        {item.text}
      </p>
      {item.products && item.products.length > 0 ? (
        <ul className="-mx-4 flex w-[calc(100%+2rem)] snap-x gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:thin]" aria-label="สินค้าที่แนะนำ">
          {item.products.map((p) => (
            <ProductCard key={p.slug} p={p} onLeave={onLeave} />
          ))}
        </ul>
      ) : null}
      {item.actions && item.actions.length > 0 ? (
        <div className="flex max-w-[90%] flex-wrap gap-2">
          {item.actions.map((a) => (
            <ActionLink key={a.href} a={a} onLeave={onLeave} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionLink({ a, onLeave }: { a: AssistantAction; onLeave: () => void }) {
  const href = safeHref(a.href);
  if (!href) return null;
  const cls =
    "inline-flex cursor-pointer items-center gap-1 rounded-full bg-accent-soft px-3.5 py-1.5 text-[13px] font-medium text-link transition hover:bg-accent hover:text-accent-contrast";
  if (isExternal(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {a.label}
        <span aria-hidden>↗</span>
      </a>
    );
  }
  return (
    <Link href={href} onClick={onLeave} className={cls}>
      {a.label}
      <span aria-hidden>›</span>
    </Link>
  );
}

function ProductCard({ p, onLeave }: { p: AssistantCard; onLeave: () => void }) {
  const { add, busy } = useCart();
  const [added, setAdded] = useState(false);
  return (
    <li className="w-[150px] shrink-0 snap-start overflow-hidden rounded-[18px] border border-hairline-soft bg-canvas">
      <Link href={`/p/${encodeURIComponent(p.slug)}`} onClick={onLeave} className="block cursor-pointer">
        <div className="aspect-square bg-canvas-alt">
          {p.image_url ? (
            <Img src={p.image_url} alt={p.name} width={150} height={150} sizes="150px" className="size-full object-cover" />
          ) : null}
        </div>
        <div className="space-y-1 px-3 pt-2">
          <p className="line-clamp-2 min-h-[2.5em] text-[13px] leading-tight">{p.name}</p>
          <Price value={p.price_satang} strike={p.on_flash_sale ? p.lowest_30d_satang : null} sale={p.on_flash_sale} from={p.price_from} size="sm" />
          {!p.in_stock ? <p className="text-xs text-ink-2">หมดชั่วคราว</p> : null}
        </div>
      </Link>
      <div className="px-3 pb-3 pt-2">
        {p.variant_id != null && p.in_stock ? (
          <button
            type="button"
            disabled={busy || added}
            onClick={() => {
              void add(p.variant_id!, 1, undefined, p.name).then((ok) => ok && setAdded(true));
            }}
            className="h-8 w-full cursor-pointer rounded-full bg-ink text-xs font-medium text-white transition hover:bg-black disabled:cursor-default disabled:opacity-50"
          >
            {added ? "เพิ่มแล้ว ✓" : "ใส่ตะกร้า"}
          </button>
        ) : (
          <Link
            href={`/p/${encodeURIComponent(p.slug)}`}
            onClick={onLeave}
            className="grid h-8 w-full cursor-pointer place-items-center rounded-full bg-canvas-alt text-xs font-medium text-ink transition hover:bg-hairline-soft"
          >
            ดูตัวเลือก
          </Link>
        )}
      </div>
    </li>
  );
}
