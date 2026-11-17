// Minimal API client for direct calls to the Go API (:8090) with a cookie jar, CSRF and a spoofable client IP.
import { API } from "./lib.mjs";
let ipN = 1;
export class Client {
  constructor(ip) {
    this.jar = new Map();
    this.csrf = null;
    this.ip = ip ?? `10.77.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;
  }
  async req(method, path, body, headers = {}) {
    const h = { Accept: "application/json", Origin: "http://localhost:3000", "X-Forwarded-For": this.ip, ...headers };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (this.csrf && method !== "GET") h["X-CSRF-Token"] = this.csrf;
    if (this.jar.size) h.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(`${API}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (v === "" || /Max-Age=0|Max-Age=-/i.test(c)) this.jar.delete(k); else this.jar.set(k, v);
    }
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = text; }
    if (json?.data?.csrf_token) this.csrf = json.data.csrf_token;
    return { status: r.status, body: json, data: json?.data };
  }
  get(p) { return this.req("GET", p); }
  post(p, b, h) { return this.req("POST", p, b ?? {}, h); }
  put(p, b) { return this.req("PUT", p, b ?? {}); }
  patch(p, b) { return this.req("PATCH", p, b ?? {}); }
  del(p) { return this.req("DELETE", p); }
  login(email, password) { return this.post("/auth/login", { email, password }); }
}
