// HTTP-level concurrency: N distinct customers race POST /orders for a 10-unit flash item (1 per customer).
// Expect exactly 10 orders (201) and the rest 409 out_of_stock; then all 10 can be paid (PromptPay mock complete).
import { Client } from "./api.mjs";
import fs from "node:fs";
const N = Number(process.env.N ?? 100);
const { variant_id } = JSON.parse(fs.readFileSync("out/flash-variant.json", "utf8"));
const tag = Date.now().toString(36);
const users = [];
const t0 = Date.now();
await Promise.all(
  Array.from({ length: N }, async (_, i) => {
    const c = new Client(`10.88.${Math.floor(i / 200)}.${(i % 200) + 1}`);
    const r = await c.post("/auth/register", { email: `race.${tag}.${i}@example.com`, password: "Race-Pass-2026!", name: `Race ${i}`, marketing_consent: false });
    if (r.status !== 201) throw new Error(`register ${i}: ${r.status} ${JSON.stringify(r.body)}`);
    const a = await c.post("/me/addresses", { recipient_name: `Race ${i}`, phone: "0812345678", line1: "1 ถนนทดสอบ", line2: "", subdistrict: "คลองเตย", district: "คลองเตย", province: "กรุงเทพมหานคร", postal_code: "10110", is_default: true });
    if (a.status !== 201) throw new Error(`address ${i}: ${a.status} ${JSON.stringify(a.body)}`);
    const add = await c.post("/cart/items", { variant_id, qty: 1 });
    if (add.status !== 200) throw new Error(`cart ${i}: ${add.status} ${JSON.stringify(add.body)}`);
    const q = await c.post("/cart/quote", { address_id: a.data.id });
    users.push({ c, address_id: a.data.id, quote_hash: q.data.quote_hash, src: q.data.lines[0].price_source.kind });
  }),
);
console.log(`setup ${N} customers in ${Date.now() - t0} ms; price sources: ${[...new Set(users.map((u) => u.src))]}`);
const t1 = Date.now();
const res = await Promise.all(
  users.map((u) => u.c.post("/orders", { address_id: u.address_id, payment_method: "promptpay", quote_hash: u.quote_hash }, { "Idempotency-Key": crypto.randomUUID() }).then((r) => ({ u, r }))),
);
const by = {};
for (const { r } of res) {
  const k = `${r.status} ${r.body?.error?.code ?? ""}`.trim();
  by[k] = (by[k] ?? 0) + 1;
}
console.log(`checkout race in ${Date.now() - t1} ms:`, JSON.stringify(by));
const won = res.filter((x) => x.r.status === 201);
let paid = 0;
for (const { u, r } of won) {
  const ch = await u.c.post("/payments/charges", { order_no: r.data.order_no, method: "promptpay" });
  const done = await u.c.post(`/payments/mock/charges/${ch.data.charge_id}/complete`, { outcome: "successful" });
  const o = await u.c.get(`/orders/${r.data.order_no}`);
  if (o.data.status === "paid") paid++;
}
console.log(`paid ${paid}/${won.length}`);
const ok = won.length === 10 && paid === 10 && Object.keys(by).every((k) => k === "201" || k.startsWith("409"));
console.log(ok ? "PASS concurrency: exactly 10 orders, all paid" : "FAIL concurrency");
fs.writeFileSync("out/concurrency.json", JSON.stringify({ N, by, paid }, null, 2));
