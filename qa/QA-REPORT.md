# ShopShip — Wave 2 QA report (real stack)

Date: 2026-11-17 · Pond (full-stack) + Sompong (QA) · everything local and mock-only (no real keys, no deploy, no git).

**Stack under test:** embedded PostgreSQL 17 (`api/internal/testdb/devdb`, locale `en_US.UTF-8`) → `server seed-demo`
→ `server serve` on **:8090** (`PAYMENT_PROVIDER=mock`, `SHIPPING_CARRIER=flash_mock`) → web `npm run build && npm start`
on :3000 (`API_URL` / `NEXT_PUBLIC_MEDIA_ORIGIN=http://localhost:8090`, `NEXT_PUBLIC_PAYMENT_MOCK=true`,
`CLIENT_IP_HEADER=x-real-ip`). No mocks: the browser talks to the web origin only and goes through the
`app/api/v1/[...path]` proxy to the Go API.

**Harness (`qa/`, not part of the app):** `puppeteer-core` 25.17.0 driving the installed Chrome headless, `lighthouse`
13.6.0. Scripts: `crawl.mjs` (public pages × 4 widths: console / 4xx-5xx / broken images / horizontal scroll),
`crawl-admin.mjs` (console per role), `e2e-store.mjs`, `e2e-pricechange.mjs`, `e2e-admin-orders.mjs`,
`e2e-promos.mjs`, `e2e-admin-catalog.mjs`, `concurrency.mjs` (HTTP level), `t-mobile.mjs`, `lighthouse.mjs`,
`screenshots.mjs`. Helper scripts: `env.sh`, `restart-api.sh`, `rebuild-web.sh`, `start-web.sh`, `reset-db.sh`.
Run: `cd qa && npm install`, start the stack, then `node <script>` (Git Bash: `MSYS_NO_PATHCONV=1` for path args).
Each browser context sends a distinct `x-real-ip`, which emulates Railway's header, so per-IP login limits don't collide.
Restart the API to reset the per-email login limit (5 / 10 min) when re-running many scripts.

## 1. Checklist (final run on the final build)

| Area | Check | Result |
|---|---|---|
| Stack | devdb (en_US.UTF-8) → migrate up (6) → seed-demo → serve :8090 → `next build` + `next start` against it | PASS |
| Home | 11.11 campaign hero + `1111SALE` / `FREESHIP11` copy chips, banner carousel, flash sale countdown + sold bars, deals, best sellers, new arrivals | PASS |
| Category / search | `/c/fashion`, `/c/bags`; Thai typo `เสื้อยึด` → เสื้อยืดคอตตอนคลาสสิก first | PASS |
| PDP | variants, public price for guests; `/offers` member price for Gold (สมาชิก Gold ลด 5%), trade price for wholesale (ราคาขายส่ง ลด 8% + qty-break table), flash badge + countdown | PASS (after fix B1) |
| Cart | guest add → login → server-side merge | PASS |
| Cart quote layers | qty-break (trade tier), ซื้อ 2 แถม 1, ช้อปครบ ฿1,500 ลด ฿150, free shipping ฿990, labelled rows | PASS |
| Codes | `1111SALE` applied (−฿300, exclusive beats spend-X); `WELCOME100` applied; `FREESHIP11` → `shipping_already_free` when already free; `NOPE999` → not_found; expired `SONGKRAN` → "หมดอายุแล้ว (สิ้นสุด 18 เม.ย. 2026)"; per-customer limit → "ใช้โค้ดครบสิทธิ์แล้ว" | PASS |
| quantity_break_gap | "+N" button shown, one tap switches the line to the trade tier | PASS |
| Checkout | default address, shipping fee by weight, PromptPay QR (EMVCo) → "จำลองจ่ายสำเร็จ" → paid → confirmation | PASS |
| Card | 4242… success → paid; 4000…3220 → mock 3-DS page (through the proxy) → Approve → paid; 4000…0002 → Thai decline message, order stays pending | PASS |
| 409 price_changed | admin raises the price after the quote → dialog shows old/new total (+฿50) → confirm → order at the new price | PASS |
| Account | orders list, detail with order number, status timeline, tracking events (newest first), refunded state | PASS (after fix B6) |
| Admin login / perms | owner / admin / staff; staff nav hides customers, banners, reviews, staff, audit; the API answers 403 on direct URLs and the UI shows the 403 page | PASS |
| Dashboard | today's sales ฿4,725.50 (shown rounded ฿4,726) / 3 paid of 4, equal to `SUM(grand_total)` over paid+ orders in Bangkok today (SQL) | PASS |
| Products | UI editor: size×colour matrix (2 variants), bulk price, stock, category → create; PNG upload via the editor → optimised by next/image on the PDP; price edit in the UI → price_history row | PASS (after fix B11) |
| Inventory | adjust +5 through the UI dialog | PASS |
| Promotions hub | coupon created in the UI editor (`QA50xxxx`) and applied in a real cart; seasonal campaign + code; trade qty-break tier for wholesale (3+ = ฿200) shows in `/offers` and in the cart; new customer group 20 % + assigning a customer gives them the group price; flash sale with 10 units; every tab lists the new item | PASS |
| Simulator | "ขายส่ง 12 ชิ้น + ส่งฟรี" preset as the wholesale group: preview totals + adjustments are **identical** to the real wholesale cart quote (incl. weight-based shipping) | PASS (after fixes B9, B10) |
| Orders | paid → packing (iPad 1024 tap checklist) → create shipment + label (tracking `TH##########MK`) → mock-advance ×4 → delivered → refund; history has 6 entries | PASS |
| Reviews / banners / audit | hide a review via UI; banners page; audit log has promotion/campaign/flash/user/inventory/order/shipment actions | PASS |
| Concurrency | 100 distinct customers race `POST /orders` for a 10-unit flash item (1/customer): **10 × 201**, 90 × 409, and all 10 paid | PASS |
| Responsive | 375 / 768 / 1024 / 1440 on home, PDP, category, cart, checkout, search, flash-sale, promotions: no horizontal scroll; mobile bottom tab bar; PDP sticky buy bar | PASS |
| Console / network | public crawl (16 pages × 4 widths) and admin crawl: 0 console errors, 0 unexpected 4xx/5xx (only the intended 404 page), 0 broken images, no hydration warnings | PASS (after fixes B3, B4, B5) |

Notes:
- The 90 losers in the race get `409 price_changed`, not `out_of_stock`. Once the 10 flash units are gone, the line
  falls back to the list price, so the re-priced quote differs. The fresh quote is in `details.quote`, and the UI shows
  the price-changed dialog. This is the documented flash-fallback behaviour.
- The final suite ran on a freshly reseeded DB: storefront 24/24, promotions 24/24, catalog 9/9, price-change 3/3,
  concurrency 1/1, mobile 2/2 (h-scroll sweep clean), admin fulfilment 9/9 → **72/72 PASS**.

## 2. Bugs found → fixed (16 found, 16 fixed)

| # | Bug (real stack only; mocks hid it) | Fix |
|---|---|---|
| B1 | A guest PDP showed "ราคาส่งสำหรับคุณ" and "ได้ราคาส่งแล้ว!" from `/offers` qty_breaks, but the cart quote never applies L1 prices to guests, so the shown price ≠ the charged price | `web/src/components/product/detail.tsx`: tiers apply only when signed in; for guests the table is labelled "ราคาส่งตามจำนวน (สำหรับสมาชิก)" with a login link |
| B2 | Marketing copy didn't match the seeded rules: free shipping "฿999" (rule is ฿990), Gold "ลดสูงสุด 10%" (rule is 5%), trade copy promised a code | `web/src/lib/site.ts`, `components/product/detail.tsx`, `app/(site)/promotions/page.tsx` |
| B3 | Every guest page logged `401 /auth/me` as a console error (also fails Lighthouse best-practices) | API: `GET /auth/me?optional=true` → `200 {data:null}` for guests (`api/internal/auth/handlers.go`, test in `auth_e2e_test.go`); web `lib/api/storefront.ts#getMe` and the mock; documented in `docs/API.md` (additive) |
| B4 | Admin "ผู้ใช้หลังร้าน" page: `GET /admin/users?role=staff,admin,owner` → 400 | `api/internal/admin/users.go` accepts a comma list (`role = ANY(...)`); `docs/API.md` |
| B5 | Mock 3-DS page → `/favicon.ico` 404 through the proxy | `api/internal/payments/payments.go` (inline empty icon) |
| B6 | Customer order detail didn't show the order number; an empty variant name rendered "· 1 × ฿2,490" | `web/src/components/account/views.tsx` |
| B7 | Admin order totals listed ซื้อ 2 แถม 1 (already inside the line totals) and free shipping twice, so the rows didn't add up to ยอดชำระ | `web/src/components/admin/pages/order-detail.tsx` (only L3/L4 rows; L5 label on the shipping-discount row) |
| B8 | Admin "เลื่อนสถานะพัสดุ" toast showed the oldest event (tracking events are newest first) | `order-detail.tsx`; event order documented in `docs/API.md` |
| B9 | Simulator presets used fixture variant ids (101, 205, …) and group id 2, so they were broken on a real DB | `web/src/components/admin/pages/promotions/simulator.tsx`: seed presets by product slug resolved at click time, group by code; fixture presets kept under mocks |
| B10 | Simulator preview used the flat shipping rate while the real quote uses the carrier (weight surcharge): ฿40 vs ฿55, so the savings differed | `api/internal/promotions/admin.go` (`ShippingFee` seam + cart weight), wired in `api/internal/http/router.go` (shipping imports promotions, so it can't be imported the other way) |
| B11 | Uploaded product photos returned 400 from `/_next/image` locally (Next 16 refuses loopback upstreams) | `web/next.config.ts`: `dangerouslyAllowLocalIP` only when `NEXT_PUBLIC_MEDIA_ORIGIN` is a loopback host |
| B12 | `/media/*` was served with `X-Robots-Tag: noindex` and no cache headers | `api/internal/http/router.go`: media group with `Cache-Control: public, max-age=604800`, no robots tag, sandbox CSP |
| B13 | A11y (Lighthouse 94–97): `aria-label` on a plain span (stars), copy-code button name ≠ visible text, campaign hero contrast (badge 3.6, CTA 4.3, subtitle 3.3), countdown separators 2.3, variant chip label mismatch + out-of-stock contrast, heading order on category/search | `components/ui/primitives.tsx`, `components/ui/motion.tsx`, `components/home/campaign-hero.tsx` (darker accent ink via `color-mix`), `components/product/variant-picker.tsx`, `components/product/browser.tsx` → **a11y 100** |
| B14 | Perf: above-the-fold product tiles started at opacity 0 (scroll reveal), which held the LCP image until hydration; LCP images had no fetch priority; every rating rendered 10 SVGs (home had 1,852 DOM nodes) | `components/product/grid.tsx` (priority tiles skip the reveal), `c/[slug]/page.tsx` fallback priority, `fetchPriority="high"` in `home/campaign-hero.tsx`, `product/gallery.tsx`, `product/tile.tsx`; stars use a 2-element CSS mask |
| B15 | Mobile tab bar: the floating cart button covered the "ตะกร้า" label | `web/src/components/layout/bottom-nav.tsx` |
| B16 | `NEXT_PUBLIC_PAYMENT_MOCK` was undocumented, so on the real stack the PromptPay page had no TEST "simulate payer" buttons | `web/.env.example`, `docs/DEMO.md` |

## 3. Gates (final)
- api: `GOTOOLCHAIN=local go build ./... && go vet ./... && go test ./...` → all packages `ok` (admin, auth, config,
  http, orders, pricing, promotions, testdb), exit 0.
- web: `npm run build` (real API) ✓, `NEXT_PUBLIC_USE_MOCKS=true npm run build` ✓, `npm run lint` ✓ (0 problems),
  `npm test` ✓ 22/22.

## 4. Lighthouse (`next start` build, local Chrome headless, after fixes)

| Page | Mobile perf | a11y | best-pr. | SEO | Mobile LCP / TBT | Desktop perf | a11y | bp | SEO |
|---|---|---|---|---|---|---|---|---|---|
| `/` | 74–88 | 100 | 100 | 100 | 3.6–3.7 s / 190–610 ms | 100 | 100 | 100 | 100 |
| `/p/cotton-tee-classic` | 67–75 | 100 | 100 | 100 | 3.6 s / 570–1,080 ms | 100 | 100 | 100 | 100 |
| `/c/fashion` | 86–87 | 100 | 100 | 100 | 3.6 s / 210–240 ms | 99–100 | 100 | 100 | 100 |

Before the fixes, mobile was 64 / 64 / 75 perf with a11y 94 / 97 / 95. Mobile perf is noisy on this machine
(simulated 4× CPU) and stays under the 90 target. The remaining cost is React hydration plus `motion` (react-dom chunk
≈1 s of script on throttled CPU, style/layout ≈1.5 s). See known gaps.

## 5. Screenshots (real stack, freshly reseeded DB) — `docs/screenshots/real/`
`home-1440.png`, `home-1440-full.png`, `home-375.png`, `home-375-full.png`, `product-wholesale-1440.png` (trade price +
3-tier table), `cart-layers-1111sale-1440.png` (Gold member price + trade tier + ซื้อ 2 แถม 1 + 1111SALE + gap hints),
`promptpay-1440.png`, `order-confirmation-1440.png`, `admin-dashboard-1440.png`, `admin-promotions-campaigns-1440.png`
(timeline), `admin-promotions-trade-1440.png`, `admin-simulator-1440.png`, `admin-packing-1024.png`.

## 6. Known gaps (not fixed)
1. **Mobile Lighthouse perf 67–88 (< 90).** Hydration and `motion` dominate TBT. Next steps: `LazyMotion` + `m.*`
   instead of `motion.*`, move the flip-countdown / scroll-linked hero effects behind idle, and trim the PDP client tree.
   Desktop is 99–100.
2. **Client IP behind the proxy.** Without `CLIENT_IP_HEADER` (and the API trusting the web's IP), every shopper shares
   the web server's IP for the per-IP login limit (5 / 10 min). This is a deployment config item, documented in
   DEMO.md §6.
3. **Auto-SKU collisions.** `suggestSku` uses the first 4 letters of the English name, so similar names collide and
   create returns 409 "ข้อมูลซ้ำ (slug หรือ SKU)". The message is shown, but the field isn't highlighted.
4. The PDP caps the flash qty stepper at 1 even when `per_customer_limit` is 2. `FlashBadge` doesn't expose the limit;
   the cart and checkout enforce the real limit.
5. A staff user who opens a forbidden admin URL directly gets the 403 page after a 403 API call. The nav hides those
   pages, but the page doesn't pre-check `me.perms` before fetching.
6. Losers of a flash race get `price_changed` (list-price fallback) rather than `out_of_stock` (see the note above).
   That is by design, but the dialog copy could say "Flash Sale หมดแล้ว".
7. `next start` warns under `output: "standalone"`. Production uses `node .next/standalone/server.js` (Dockerfile).
8. Not automated: banner create/edit form, category drag-reorder, the customer-facing wishlist / addresses CRUD (all
   rendered without console errors in the crawl), and the review-reply form.
