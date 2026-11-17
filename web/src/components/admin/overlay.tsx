"use client";

/** Toasts, modal/sheet dialog and confirm() for the back office. Owner: admin agent. */
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api/client";
import { Button, IconButton } from "./ui";

// ---------- toast ----------
type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string };
type Ctx = {
  toast: (message: string, tone?: ToastTone) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
};
type ConfirmOptions = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };
const OverlayCtx = createContext<Ctx | null>(null);

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "validation_failed" && e.fields) {
      const first = Object.values(e.fields)[0];
      return first ? `${e.message}: ${first}` : e.message;
    }
    return e.message;
  }
  return "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirm] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);
  const toast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirm({ ...o, resolve })), []);
  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirm(null);
  };
  return (
    <OverlayCtx.Provider value={{ toast, confirm }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4 md:bottom-auto md:left-auto md:right-4 md:top-4 md:items-end">
        {toasts.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? XCircle : Info;
          return (
            <div
              key={t.id}
              role={t.tone === "error" ? "alert" : "status"}
              className="animate-[toast-in_220ms_var(--ease-out)] pointer-events-auto flex max-w-sm items-start gap-2 rounded-[12px] border border-hairline-soft bg-surface/95 px-3.5 py-2.5 text-sm text-ink shadow-[var(--shadow-pop)] backdrop-blur"
            >
              <Icon className={clsx("mt-0.5 size-4 shrink-0", t.tone === "success" ? "text-success" : t.tone === "error" ? "text-danger" : "text-link")} aria-hidden />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>
      <Dialog open={Boolean(confirmState)} onClose={() => close(false)} title={confirmState?.title ?? ""} size="sm"
        footer={
          <>
            <Button onClick={() => close(false)}>ยกเลิก</Button>
            <Button variant={confirmState?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {confirmState?.confirmLabel ?? "ยืนยัน"}
            </Button>
          </>
        }
      >
        <div className="flex gap-3">
          {confirmState?.danger ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden /> : null}
          <div className="text-sm text-ink-2">{confirmState?.body}</div>
        </div>
      </Dialog>
      <style>{`@keyframes toast-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}@keyframes dlg-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@keyframes fade-in{from{opacity:0}to{opacity:1}}`}</style>
    </OverlayCtx.Provider>
  );
}
export function useOverlay(): Ctx {
  const c = useContext(OverlayCtx);
  if (!c) throw new Error("useOverlay outside OverlayProvider");
  return c;
}
export const useToast = () => useOverlay().toast;
export const useConfirm = () => useOverlay().confirm;

// ---------- dialog (centered modal ≥ sm, bottom sheet on phones) ----------
export function Dialog({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>("[autofocus], input, select, textarea, button:not([aria-label='ปิด'])");
      el?.focus();
    }, 30);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-[fade-in_180ms_ease-out] bg-[var(--overlay)]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={clsx(
          "relative flex max-h-[92dvh] w-full animate-[dlg-in_220ms_var(--ease-out)] flex-col rounded-t-[18px] bg-surface shadow-[var(--shadow-pop)] sm:rounded-[16px]",
          size === "sm" ? "sm:max-w-md" : size === "md" ? "sm:max-w-xl" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-5xl",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-hairline-soft px-5 py-3.5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <IconButton label="ปิด" icon={X} size="sm" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="pb-safe flex flex-wrap justify-end gap-2 border-t border-hairline-soft px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
