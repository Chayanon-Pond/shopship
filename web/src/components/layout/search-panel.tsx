"use client";

import { clsx } from "clsx";
import { ArrowRight, Clock, Search, X } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import * as api from "@/lib/api/storefront";
import { Img } from "@/components/ui/primitives";
import { POPULAR, readRecent, rememberSearch } from "./search";

// Loaded on demand (first open of the search) — not part of every page's initial JS.
export function SearchPanel({ onClose, closing }: { onClose: () => void; closing?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sug, setSug] = useState<api.Suggestions | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    setRecent(readRecent());
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const o = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = o;
    };
  }, [onClose]);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const ctl = { alive: true };
    const t = setTimeout(() => {
      api
        .searchSuggest(term)
        .then((r) => ctl.alive && (setSug(r), setActive(-1)))
        .catch(() => ctl.alive && setSug({ products: [], categories: [] }));
    }, 160);
    return () => {
      ctl.alive = false;
      clearTimeout(t);
    };
  }, [q]);

  function go(term: string) {
    const t = term.trim();
    if (!t) return;
    rememberSearch(t);
    onClose();
    router.push(`/search?q=${encodeURIComponent(t)}`);
  }
  const products = q.trim() ? (sug?.products.slice(0, 6) ?? []) : [];

  return (
    <div data-closing={closing || undefined} className="fixed inset-0 z-[60] transition-opacity duration-250 starting:opacity-0 data-[closing]:opacity-0">
      <button type="button" aria-label="ปิดการค้นหา" onClick={onClose} className="absolute inset-0 bg-black/25 backdrop-blur-md" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="ค้นหาสินค้า"
        data-closing={closing || undefined}
        className="relative max-h-[100dvh] overflow-y-auto bg-white/95 pb-8 pt-[max(12px,env(safe-area-inset-top))] shadow-pop backdrop-blur-xl transition-[transform,opacity] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] starting:-translate-y-6 starting:opacity-0 data-[closing]:-translate-y-4 data-[closing]:opacity-0"
      >
        <div className="container-page max-w-[760px]">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (active >= 0 && products[active]) {
                onClose();
                router.push(`/p/${products[active].slug}`);
              } else go(q);
            }}
            className="flex items-center gap-3 border-b border-hairline-soft py-3"
          >
            <Search className="size-6 shrink-0 text-ink-2" aria-hidden />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(products.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(-1, a - 1));
                }
              }}
              type="search"
              enterKeyHint="search"
              placeholder="ค้นหา ShopShip"
              aria-label="คำค้นหา"
              aria-autocomplete="list"
              className="min-w-0 flex-1 appearance-none bg-transparent focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none text-2xl font-semibold tracking-tight outline-none placeholder:text-ink-3 md:text-[32px]"
            />
            <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-full bg-canvas-alt hover:bg-hairline-soft" aria-label="ปิด">
              <X className="size-4" aria-hidden />
            </button>
          </form>

          {!q.trim() ? (
            <div className="grid gap-8 pt-6 sm:grid-cols-2">
              {recent.length ? (
                <div>
                  <p className="mb-2 text-xs font-medium text-ink-2">ค้นหาล่าสุด</p>
                  <ul>
                    {recent.map((r) => (
                      <li key={r}>
                        <button type="button" onClick={() => go(r)} className="flex w-full items-center gap-2 rounded-[8px] py-1.5 text-left font-medium hover:text-link">
                          <Clock className="size-4 text-ink-3" aria-hidden /> {r}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <p className="mb-2 text-xs font-medium text-ink-2">คำค้นยอดนิยม</p>
                <ul className="flex flex-wrap gap-2">
                  {POPULAR.map((p) => (
                    <li key={p}>
                      <button type="button" onClick={() => go(p)} className="rounded-pill bg-canvas-alt px-3.5 py-1.5 text-sm font-medium transition hover:bg-hairline-soft active:scale-95">
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="pt-4">
              {sug?.categories.length ? (
                <div className="mb-4 flex flex-wrap gap-2">
                  {sug.categories.map((c) => (
                    <Link key={c.id} href={`/c/${c.slug}`} onClick={onClose} className="rounded-pill bg-accent-soft px-3 py-1 text-sm font-medium text-link">
                      หมวด {c.name}
                    </Link>
                  ))}
                </div>
              ) : null}
              <p className="mb-1 text-xs font-medium text-ink-2">{sug ? (products.length ? "สินค้าที่แนะนำ" : `ไม่พบสินค้าที่ตรงกับ “${q}”`) : "กำลังค้นหา…"}</p>
              <ul role="listbox" aria-label="คำแนะนำ">
                {products.map((p, i) => (
                  <li key={p.slug} role="option" aria-selected={i === active}>
                    <Link
                      href={`/p/${p.slug}`}
                      onClick={onClose}
                      className={clsx("flex items-center gap-3 rounded-[12px] p-2 transition", i === active ? "bg-canvas-alt" : "hover:bg-canvas-alt")}
                    >
                      <span className="relative size-11 shrink-0 overflow-hidden rounded-[10px] bg-canvas-alt">
                        {p.image_url ? <Img src={p.image_url} alt="" fill sizes="44px" className="object-cover" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <ArrowRight className="size-4 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
              {products.length ? (
                <button type="button" onClick={() => go(q)} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">
                  ดูผลการค้นหาทั้งหมดของ “{q}” <ArrowRight className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
