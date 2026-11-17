"use client";

import { clsx } from "clsx";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useRef, useState, type ComponentType } from "react";
import { useConsent } from "@/components/store/consent";
import { placementFor, productSlug } from "./chat-lib";

export type ChatPanelProps = { open: boolean; onClose: () => void; productSlug?: string };

// The sheet (messages, cards, API calls) is a separate chunk fetched on first
// intent (hover/focus/touch) or click, so the storefront's initial JS only
// carries this launcher button.
let panelPromise: Promise<ComponentType<ChatPanelProps>> | null = null;
function loadPanel() {
  panelPromise ??= import("./chat-panel").then((m) => m.ChatPanel);
  panelPromise.catch(() => {
    panelPromise = null;
  });
  return panelPromise;
}

/** Floating "ผู้ช่วย ShopShip" launcher, mounted once in (site)/layout.tsx. */
export function ChatWidget() {
  return (
    <Suspense fallback={null}>
      <Launcher />
    </Suspense>
  );
}

function Launcher() {
  const path = usePathname();
  const [Panel, setPanel] = useState<ComponentType<ChatPanelProps> | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const place = placementFor(path);
  const { ready, decided, settingsOpen } = useConsent();

  const openChat = useCallback(() => {
    setLoading(true);
    loadPanel()
      .then((P) => {
        setPanel(() => P);
        setOpen(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => btn.current?.focus());
  }, []);
  const prefetch = useCallback(() => void loadPanel().catch(() => {}), []);

  if (place.hidden) return null;
  // Never moves after it is painted (no CLS): it is not server-rendered, and it only appears once the first-visit
  // cookie bar is not on screen (before a choice the bar owns the bottom of the viewport). It fades in when it appears.
  if (!ready || (!decided && !open) || (settingsOpen && !open)) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={openChat}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onTouchStart={prefetch}
        aria-label="เปิดผู้ช่วย ShopShip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={Panel ? "assistant-panel" : undefined}
        aria-busy={loading || undefined}
        style={{
          bottom: "calc(max(var(--bottom-nav-h, 0px), env(safe-area-inset-bottom)) + var(--assistant-bar, 0px) + var(--assistant-gap, 16px))",
        }}
        className={clsx(
          "fixed right-4 z-[45] grid size-14 cursor-pointer place-items-center rounded-full bg-ink text-white shadow-[0_10px_30px_rgb(0_0_0/0.22)] ring-4 ring-white/70 transition-[transform,opacity] duration-200 starting:scale-90 starting:opacity-0 hover:scale-105 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 md:right-6",
          "[--assistant-gap:16px] md:[--assistant-gap:24px]",
          place.lift === "always" && "[--assistant-bar:76px]",
          place.lift === "below-lg" && "[--assistant-bar:76px] lg:[--assistant-bar:0px]",
          open && "pointer-events-none scale-90 opacity-0",
        )}
      >
        {loading ? (
          <span className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
        ) : (
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.7-.8L3 20.5l1.4-4.4A8 8 0 0 1 3 11.5 8.6 8.6 0 0 1 12 3a8.6 8.6 0 0 1 9 8.5Z" />
            <path d="M12 8.2v.01M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth={2.6} />
          </svg>
        )}
      </button>
      {Panel ? <Panel open={open} onClose={close} productSlug={productSlug(path)} /> : null}
    </>
  );
}
