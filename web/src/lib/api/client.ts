/**
 * Typed fetch wrapper for the ShopShip API (docs/API.md).
 *
 * - Browser: calls same-origin `/api/v1/...` (proxied to API_URL by
 *   app/api/v1/[...path]/route.ts) so session/cart cookies are first-party.
 * - Server: calls `${API_URL}/api/v1/...` directly. Only PUBLIC data should be
 *   fetched on the server inside cached components; member prices, cart,
 *   quotes and anything personal are fetched client-side with no-store.
 * - NEXT_PUBLIC_USE_MOCKS=true serves docs/fixtures (synced into src/mocks)
 *   instead of calling the network.
 *
 * Owner: coordinator (frozen). Endpoint wrappers live in storefront.ts / admin.ts.
 */
import type { ApiErrorBody, ErrorCode } from "./types";

export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly details?: unknown;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
    this.details = body.details;
  }
}

// CSRF token from login/register/me (kept in memory only, never localStorage).
let csrfToken: string | null = null;
export function getCsrfToken(): string | null {
  return csrfToken;
}
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Personal data: never cached (default true for non-GET and in the browser). */
  noStore?: boolean;
};

export function buildQuery(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function baseUrl(): string {
  if (typeof window !== "undefined") return "";
  return (process.env.API_URL ?? "http://localhost:8080").replace(/\/$/, "");
}

/**
 * Low-level request. Returns the parsed JSON envelope (`{data}` or
 * `{data, meta}`) or undefined for 204. Throws ApiError on non-2xx.
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  if (USE_MOCKS) {
    const { mockRequest } = await import("@/mocks/handler");
    return mockRequest<T>(method, path, opts.query, opts.body);
  }
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;

  const res = await fetch(`${baseUrl()}/api/v1${path}${buildQuery(opts.query)}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: "include",
    signal: opts.signal,
    cache: opts.noStore || method !== "GET" ? "no-store" : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const body: ApiErrorBody =
      json && typeof json === "object" && "error" in json
        ? (json as { error: ApiErrorBody }).error
        : { code: "internal", message: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
    throw new ApiError(res.status, body);
  }
  return json as T;
}

/** GET returning `data` only. */
export async function getData<T>(path: string, opts: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
  return (await request<{ data: T }>(path, { ...opts, method: "GET" })).data;
}

/** Mutation returning `data` (or undefined for 204). */
export async function send<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const env = await request<{ data: T } | undefined>(path, { method, body, headers, noStore: true });
  return env?.data as T;
}
