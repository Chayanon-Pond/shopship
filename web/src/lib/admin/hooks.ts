"use client";

/** Client data hooks for the back office (everything is no-store, fetched in the browser). */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type State<T> = { key: string | null; data?: T; error?: unknown };

/**
 * Fetch on mount and whenever `key` changes. Keeps the previous data while
 * reloading (so lists don't flash), exposes `reload()` and `mutate()`.
 */
export function useApi<T>(fn: () => Promise<T>, key: string, enabled = true) {
  const [state, setState] = useState<State<T>>({ key: null });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const k = `${key}#${nonce}`;
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fnRef.current().then(
      (data) => alive && setState({ key: k, data }),
      (error) => alive && setState((s) => ({ key: k, data: s.data, error })),
    );
    return () => {
      alive = false;
    };
  }, [k, enabled]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const mutate = useCallback((data: T | ((prev: T | undefined) => T)) => setState((s) => ({ ...s, data: typeof data === "function" ? (data as (p: T | undefined) => T)(s.data) : data })), []);
  return {
    data: state.data,
    error: state.key === k ? state.error : undefined,
    loading: enabled && state.key !== k,
    reload,
    mutate,
  };
}

/** URL-backed filter state (?q=&status=&page=) so filters survive reloads and are shareable. */
export function useUrlState<K extends string>(keys: readonly K[]) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const values = useMemo(() => Object.fromEntries(keys.map((k) => [k, sp.get(k) ?? ""])) as Record<K, string>, [sp, keys]);
  const set = useCallback(
    (patch: Partial<Record<K | "page", string | number | null>>, resetPage = true) => {
      const p = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") p.delete(k);
        else p.set(k, String(v));
      }
      if (resetPage && !("page" in patch)) p.delete("page");
      const s = p.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  return { values, set, page };
}

/** Debounced value (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
