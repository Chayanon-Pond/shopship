/**
 * Same-origin proxy: browser -> /api/v1/* (this handler) -> ${API_URL}/api/v1/*.
 * Keeps shopship_session / shopship_cart cookies first-party. Forwards only an
 * allowlist of headers, forces Path=/ and strips Domain on Set-Cookie, and
 * marks every response no-store. Payment/carrier webhooks do NOT come through
 * here (providers call the API directly).
 * Owner: coordinator.
 */
import type { NextRequest } from "next/server";

const API_URL = (process.env.API_URL ?? "http://localhost:8080").replace(/\/$/, "");
const MAX_BODY = 8 * 1024 * 1024;
const FORWARD_REQ = ["accept", "content-type", "cookie", "x-csrf-token", "idempotency-key", "origin", "user-agent", "x-request-id"];
const FORWARD_RES = ["content-type", "retry-after", "x-request-id", "location", "content-disposition", "cache-control"];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  if (path.some((s) => s === ".." || s === "." || s.includes("\\"))) {
    return Response.json({ error: { code: "bad_request", message: "คำขอไม่ถูกต้อง" } }, { status: 400 });
  }
  const target = `${API_URL}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of FORWARD_REQ) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = (process.env.CLIENT_IP_HEADER && req.headers.get(process.env.CLIENT_IP_HEADER)) || "";
  if (ip) headers.set("x-forwarded-for", ip.split(",")[0].trim());

  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_BODY) {
      return Response.json({ error: { code: "payload_too_large", message: "ไฟล์หรือข้อมูลใหญ่เกินไป" } }, { status: 413 });
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual", cache: "no-store" });
  } catch {
    return Response.json(
      { error: { code: "service_unavailable", message: "ระบบขัดข้องชั่วคราว กรุณาลองใหม่" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const out = new Headers({ "cache-control": "no-store" });
  for (const h of FORWARD_RES) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  for (const c of upstream.headers.getSetCookie()) {
    out.append("set-cookie", c.replace(/;\s*Domain=[^;]*/i, "").replace(/;\s*Path=[^;]*/i, "") + "; Path=/");
  }
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
