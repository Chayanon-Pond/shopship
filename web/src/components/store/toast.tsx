"use client";

import { clsx } from "clsx";
import { CircleAlert, CircleCheck } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Toast = { id: number; text: string; tone: "ok" | "error"; action?: { label: string; href: string }; leaving?: boolean };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const id = useRef(1);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const n = id.current++;
    setList((l) => [...l.slice(-2), { ...t, id: n }]);
    // fade out (CSS) for the last 300 ms, then remove
    setTimeout(() => setList((l) => l.map((x) => (x.id === n ? { ...x, leaving: true } : x))), 3300);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== n)), 3600);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[90] flex flex-col items-center gap-2 px-4 md:bottom-8"
        aria-live="polite"
        role="status"
      >
        {list.map((t) => (
            <div
              key={t.id}
              className={clsx(
                "pointer-events-auto flex max-w-md items-center gap-3 rounded-pill bg-ink/90 py-2.5 pl-4 pr-2.5 text-sm text-white shadow-pop backdrop-blur-xl",
                "transition-[transform,opacity] duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] starting:translate-y-4 starting:scale-[0.96] starting:opacity-0",
                t.leaving && "translate-y-2 scale-[0.98] opacity-0",
              )}
            >
              {t.tone === "ok" ? (
                <CircleCheck className="size-4 shrink-0 text-[#30d158]" aria-hidden />
              ) : (
                <CircleAlert className="size-4 shrink-0 text-[#ff6961]" aria-hidden />
              )}
              <span className="min-w-0">{t.text}</span>
              {t.action ? (
                <Link href={t.action.href} className="shrink-0 rounded-pill bg-white/15 px-3 py-1 font-medium hover:bg-white/25">
                  {t.action.label}
                </Link>
              ) : (
                <span className="w-1.5" />
              )}
            </div>
          ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
