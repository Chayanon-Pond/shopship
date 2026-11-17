# ShopShip — run the API locally with demo data

Everything here is local and mock-only: no real keys, no external accounts, no downloads beyond the
embedded-postgres binaries that `go test` already caches (`~/.embedded-postgres-go`).

## 1. Database (pick one)

**A. Embedded PostgreSQL 17, no Docker** (persistent, data in `api/data/devdb`, gitignored):

```bash
cd api
GOTOOLCHAIN=local go run ./internal/testdb/devdb            # -port 55432 -dir ./data/devdb -locale en_US.UTF-8
# prints DATABASE_URL=postgres://shopship:shopship-dev-only@127.0.0.1:55432/shopship?sslmode=disable
```
Leave it running and stop it with Ctrl-C. If it was killed hard, run
`./data/devdb/runtime/bin/pg_ctl stop -D ./data/devdb/data`.

**B. Your own PostgreSQL 16/17.** The database **must use a UTF-8, non-C locale** (`en_US.UTF-8`, `th_TH.UTF-8`;
on Windows `en-US`). Under `C`/`POSIX`/builtin `C.UTF-8`, pg_trgm extracts no trigrams from Thai, so migration
0001 aborts.
```sql
CREATE DATABASE shopship TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
```

## 2. Environment

`internal/config` reads only process env vars (`api/.env.example` lists them all). Minimum for local dev:

```bash
export DATABASE_URL='postgres://shopship:shopship-dev-only@127.0.0.1:55432/shopship?sslmode=disable'
export COOKIE_SECURE=false                 # http://localhost
export PAYMENT_WEBHOOK_SECRET=dev-only-webhook-secret
export PUBLIC_BASE_URL=http://localhost:8080   # media URLs (/media/*)
export WEB_BASE_URL=http://localhost:3000      # reset links, mock 3-DS page (goes through the web proxy)
export PORT=8080                               # use another port (e.g. 8090) if 8080 is taken (Jenkins); then
                                               # PUBLIC_BASE_URL / the web's API_URL + NEXT_PUBLIC_MEDIA_ORIGIN must match
# defaults: PAYMENT_PROVIDER=mock, SHIPPING_CARRIER=flash_mock, STORAGE_DRIVER=local, MEDIA_DIR=./data/media
```

## 3. Migrate, seed, serve

```bash
cd api
GOTOOLCHAIN=local go run ./cmd/server seed-demo      # runs migrations, then seeds (no-op when already seeded)
GOTOOLCHAIN=local go run ./cmd/server serve          # :8080, also runs the reservation-expiry job every minute
# optional: create/upgrade a back-office login without the demo data
ADMIN_PASSWORD='choose-a-password' GOTOOLCHAIN=local go run ./cmd/server create-admin --email me@shop.local --name "Me" --role owner
```
`seed-demo` refuses to run with `APP_ENV=production`.

The seed contains:
- 8 top-level categories (fashion, beauty, gadgets, home, sports, kids, food & snacks, stationery), each with 2–4
  sub-categories.
- 60 products with Thai and English names (fictional brands) and 1–12 variants each (size, colour, volume and so on).
- Prices in satang. Stock is random, with a few products low or out of stock.
- Price history dated 45 days back, so strike-through prices work.
- Reviews, and 3 generic banners.
- Product images are SVGs generated locally into `MEDIA_DIR/seed/products/` and served at `/media/...`.
- The promotions demo from `promotions.SeedDemo`: campaigns, codes, trade tiers and a flash sale.

## 4. Demo logins

| Role | Email | Password | Notes |
|---|---|---|---|
| owner | `owner@shopship.local` | `Demo-Owner-2026` | all perms incl. `staff:manage` |
| admin | `admin@shopship.local` | `Demo-Admin-2026` | everything but role changes |
| staff | `staff@shopship.local` | `Demo-Staff-2026` | dashboard, catalog read, inventory, orders read/fulfil |
| customer | `customer@shopship.local` | `Demo-Customer-2026` | standard tier, has an address |
| wholesale customer | `wholesale@shopship.local` | `Demo-Wholesale-2026` | group `wholesale` (trade prices) |
| Gold customer | `gold@shopship.local` | `Demo-Gold-2026` | tier `gold` |

These are local demo credentials only. Never seed them into a shared or production database.
Login is rate-limited to 5 attempts per 10 minutes per IP and per email; restart the API to reset the counters.

## 5. Walk-through: checkout, mock payment, mock shipping

1. Add to cart: `POST /api/v1/cart/items {variant_id, qty}` (guest cart via cookie). Log in and the guest cart
   is merged into the account cart.
2. Price it: `POST /api/v1/cart/quote {address_id}` returns `quote_hash`.
3. Order it: `POST /api/v1/orders` with header `Idempotency-Key: <uuid>` and body
   `{address_id, payment_method, quote_hash}`. The order starts as `pending_payment`, and stock is held for 15 minutes.
4. Pay:
   - **PromptPay:** `POST /api/v1/payments/charges {order_no, method:"promptpay"}` returns `promptpay.qr_payload`
     (EMVCo, with CRC). To simulate the payer, call
     `POST /api/v1/payments/mock/charges/:charge_id/complete {"outcome":"successful"|"failed"}`. This emits the
     same `charge.complete` webhook, and the order becomes `paid`.
   - **Card:** use the mock tokens. `tokn_test_success` succeeds at once. `tokn_test_failure` is declined.
     `tokn_test_3ds` (or no token) returns `requires_action` and an `authorize_uri`, a mock 3-D Secure page with
     Approve/Decline buttons that redirects to `return_uri?charge_id=...`.
   - **Webhook (curl):**
     `POST /api/v1/webhooks/payments/mock` with header `X-Webhook-Secret: $PAYMENT_WEBHOOK_SECRET` and body
     `{"id":"evnt_1","type":"charge.complete","data":{"id":"<charge_id>"}}`. It is deduped by event id, and the
     charge is always re-fetched from the provider.
5. Fulfil, as staff or above:
   - `POST /api/v1/admin/orders/:order_no/status {"to":"packing"}`.
   - `POST /api/v1/admin/orders/:order_no/shipments {}` returns a tracking number `TH##########MK` and a printable
     label at `GET /api/v1/admin/shipments/:id/label`. The order becomes `shipped`.
   - `POST /api/v1/admin/shipments/:id/mock-advance` steps through picked_up, in_transit, out_for_delivery and
     delivered. Delivered moves the order to `delivered`.
   - The customer sees `GET /api/v1/orders/:order_no/tracking`.
6. Unpaid orders are cancelled after 15 minutes by the expiry job. Stock, flash allocation and coupon usage are
   released idempotently. A payment that arrives late is refunded automatically.

## 6. Web against the real API (production build)

```bash
cd web
export API_URL=http://localhost:8080                 # server-side reads + the /api/v1 proxy target
export NEXT_PUBLIC_MEDIA_ORIGIN=http://localhost:8080 # next/image may optimise /media/** (loopback allowed in next.config)
export NEXT_PUBLIC_SITE_URL=http://localhost:3000
export NEXT_PUBLIC_PAYMENT_MOCK=true                 # shows the TEST "simulate payer" buttons on the PromptPay page
npm run build && npm start                           # the API must be up during the build (public pages prerender)
```
- `npm start` prints a warning because of `output: "standalone"`; it still works locally. The Docker image runs
  `node .next/standalone/server.js`.
- The browser only talks to the web origin (`/api/v1/*` is proxied, cookies stay first-party), so the API's
  `CORS_ALLOWED_ORIGINS` must contain the web origin (`http://localhost:3000`).
- **Client IP:** the proxy forwards the shopper's IP only when `CLIENT_IP_HEADER` is set (e.g. `x-real-ip` on Railway,
  `cf-connecting-ip` behind Cloudflare) and the API trusts the web's address (`TRUSTED_PROXIES`). Without it every
  login comes from the web server's IP and the per-IP login limit (5 / 10 min) is shared by all shoppers.
- Wave 2 QA harness (puppeteer-core + Lighthouse against the local Chrome) lives in `qa/`; see `qa/QA-REPORT.md`.

## 6a. Transactional email (preview locally)

Mail is queued in `email_outbox` in the same transaction as the event (registration, order placed, paid, shipped,
delivered, cancelled, payment window expired, refund) and sent by a worker inside `server serve` every 5 s with retries
(30 s doubling, up to 8 attempts, then `status='failed'`). Password-reset mail is sent immediately (not queued: it carries the token).

```bash
export EMAIL_DRIVER=file          # default is log (subject + text body in the API log; envelope only in production)
export MAIL_DIR=./data/mail       # default
GOTOOLCHAIN=local go run ./cmd/server serve
# place an order / pay / ship in the web app, then open the newest file in a browser:
ls -t data/mail/*.html | head     # e.g. 20261117T071530.123Z-order-12-order_placed-a1b2c3.html (+ the .eml for a mail client)
```
Check the queue: `SELECT id, kind, to_email, status, attempts, last_error FROM email_outbox ORDER BY id DESC LIMIT 20;`
A failed row can be retried with `UPDATE email_outbox SET status='pending', attempts=0, next_attempt_at=now() WHERE id=…`.

Production: `EMAIL_DRIVER=resend`, `RESEND_API_KEY=re_…`, `EMAIL_FROM="ShopShip <no-reply@your-domain>"` (domain verified
in Resend), optional `EMAIL_REPLY_TO`. Without them the API still boots but logs a warning and customers get no mail.

## 6b. Bulk product import / export (CSV)

Admin → สินค้า → **นำเข้า/ส่งออก CSV** (`/admin/products/import`, needs `catalog:write`; export needs `catalog:read`).
Format: docs/API.md §12.1.1 (one row per variant, grouped by `handle`; blank cell on update = keep current value).

1. Click **ไฟล์ตัวอย่าง** for a template, or use the sample `docs/fixtures/products-import-sample.csv` (UTF-8 + BOM, works
   on the seeded demo DB: categories `tshirts`, `shirts`, `bags`, `drinks`). It has 4 products / 8 variants: Thai names,
   quoted commas and a multi-line description, colour × size options with **blank SKUs (auto-generated, unique)**, explicit
   SKUs + barcodes, `1,290.50` and `89.995` (→ ฿90.00, half-up), an inactive variant, and two external image URLs
   (`images.example.com`, stored as links, not downloaded — they show as broken images until you replace them).
2. Drop the file on the page: it runs a **dry run** (whole import in a transaction, rolled back) and shows the preview
   table — create / update / skip per row, errors highlighted with row number, column and a Thai message.
3. **ยืนยันนำเข้า** writes everything in ONE transaction (any error → nothing written). Re-importing the same file → all "ไม่เปลี่ยน".
4. **ส่งออกสินค้าทั้งหมด** downloads `shopship-products-YYYYMMDD.csv` in the same format (edit in Excel, save as
   "CSV UTF-8", re-import). Excel files saved as plain "CSV" on Thai Windows (Windows-874) are also read, with a warning.

API equivalent (session cookie + `X-CSRF-Token`):
```bash
curl -b cookies.txt -H "X-CSRF-Token: $CSRF" -H "Origin: http://localhost:3000" \
  -F file=@docs/fixtures/products-import-sample.csv "http://localhost:8080/api/v1/admin/products/import?dry_run=true"
```

## 7. Tests

```bash
cd api && GOTOOLCHAIN=local go build ./... && GOTOOLCHAIN=local go vet ./... && GOTOOLCHAIN=local go test ./...
```
Integration tests start the real router on embedded PG through `internal/testdb/apitest` (real HTTP, cookies, CSRF).
They cover:
- auth, rate limiting, password reset, CSRF and RBAC;
- guest cart merge and quote;
- checkout, mock pay, webhook, paid, shipment and delivered;
- card and 3-DS flows;
- idempotency replay;
- reservation expiry and late payment;
- 200 concurrent buyers for 50 units (exactly 50 orders succeed);
- seasonal code, trade tier and flash item, then pay, cancel and expiry release;
- coupon usage-limit race;
- seed-demo, Thai and English search, and admin catalog CRUD with uploads.
