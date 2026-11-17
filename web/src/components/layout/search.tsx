"use client";

import { Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/components/ui/fx";

const SearchPanel = dynamic(() => import("./search-panel").then((r) => r.SearchPanel), { ssr: false });

export const POPULAR = ["เสื้อยืด", "หูฟัง", "ถุงผ้า", "สมาร์ทวอทช์", "ขวดน้ำ", "กระเป๋าเป้"];
const RECENT_KEY = "shopship_recent_search";

export function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]").slice(0, 6);
  } catch {
    return [];
  }
}
export function rememberSearch(q: string) {
  try {
    const list = [q, ...readRecent().filter((x) => x !== q)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/** Header search trigger (pill on desktop, icon on mobile) + Apple-style drop-down search panel. */
export function SearchButton({ variant }: { variant: "pill" | "icon" }) {
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open, 400);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement))) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      {variant === "pill" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-full max-w-[280px] items-center gap-2 rounded-pill bg-canvas-alt px-3.5 text-sm text-ink-2 transition hover:bg-hairline-soft"
        >
          <Search className="size-4" aria-hidden />
          <span className="truncate">ค้นหาสินค้า แบรนด์ หมวดหมู่</span>
          <kbd className="ml-auto hidden rounded-[5px] border border-hairline px-1.5 text-[11px] text-ink-3 lg:inline">/</kbd>
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-full transition hover:bg-canvas-alt" aria-label="ค้นหา">
          <Search className="size-[19px]" aria-hidden />
        </button>
      )}
      {/* Portaled to <body>: the header's backdrop-filter makes it the containing block for position:fixed children,
          which squeezed this "full screen" panel into the 52px header and let the category bar paint over it. */}
      {typeof document !== "undefined" && mounted
        ? createPortal(<SearchPanel closing={closing} onClose={() => setOpen(false)} />, document.body)
        : null}
    </>
  );
}

