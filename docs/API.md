# ShopShip API — Wave 1 contract (FROZEN)

Status: **frozen at Wave 0 (2026-11-17)**. Additive changes: Wave 1 — optional `name_en` (English product name, part of `search_text`) on ProductCard/Product (public, omitted when empty) and AdminProduct/AdminProductRow + POST/PATCH bodies (always present, `""` when unset). Wave-1 agents implement exactly this. Additive changes (new optional
fields, new endpoints) need a note in this file; renames/removals need the coordinator.

Source of truth in code:
- Routes: `api/internal/*/` `Register` functions (every route below already exists and answers `501 not_implemented`).
- Quote types: `api/internal/pricing/types.go` (JSON tags = this contract).
- RBAC matrix: `api/internal/auth/rbac.go`.
- Schema: `api/migrations/0001…0005_*.sql` + Wave-1 `0006` (`products.name_en` in `search_text`, `orders.idempotency_hash`, `mock_provider_charges`).
- TypeScript mirror: `web/src/lib/api/types.ts`. Golden fixtures: `docs/fixtures/*.json`.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | API: `/api/v1`. Browser code calls the **web origin** `/api/v1/...` (Next route handler proxy `web/src/app/api/v1/[...path]/route.ts` → `API_URL`), so cookies are first-party. Server components call `API_URL` directly for public data. |
| Format | JSON, UTF-8. `Content-Type: application/json` required on bodies (except multipart uploads). Body limit 1 MiB (uploads 8 MiB). |
| Field names | `snake_case`. |
| Money | **int64 satang**, field name ends in `_satang` (`฿1,234.50` = `123450`). Never floats, never strings. |
| Percent | integer basis points, field name ends in `_bp` (`1000` = 10 %). |
| IDs | int64 numbers (`id`), except cart id (uuid, cookie only) and `order_no` (string `SS` + YYMMDD + 4–8 chars, e.g. `SS261117A7K2`). Customer-facing order URLs use `order_no`. |
| Time | RFC 3339 UTC strings (`2026-11-17T03:00:00Z`). Display in `Asia/Bangkok`. |
| Language | Error/coupon/hint `message`s are Thai, ready to display. Codes are English. |
| Nulls | Optional scalars are `null`, never omitted, unless marked `?` (omitted when empty). Lists are `[]`, never `null`. |
| Caching | Public catalog GETs: `Cache-Control: public, max-age=60, stale-while-revalidate=300`. Anything personal (`/auth/me`, `/cart*`, `/offers`, `/orders*`, `/me/*`, `/admin/*`): `Cache-Control: no-store`. |

### 1.1 Envelopes

Success, single object:
```json
{ "data": { ... } }
```
Success, list (paginated):
```json
{ "data": [ ... ], "meta": { "page": 1, "per_page": 24, "total": 137, "total_pages": 6 } }
```
Pagination params: `?page` (≥1, default 1), `?per_page` (default 24, max 48 storefront / 100 admin).
Unpaginated lists (categories tree, banners) use `{ "data": [...] }` without `meta`.

Error:
```json
{ "error": { "code": "validation_failed", "message": "กรุณาตรวจสอบข้อมูล", "fields": { "email": "อีเมลไม่ถูกต้อง" }, "details": null } }
```
`fields?` only on 422; `details?` carries machine-readable data (e.g. the fresh quote on `409 price_changed`).

### 1.2 Error codes

| HTTP | code | When |
|---|---|---|
| 400 | `bad_request` | malformed JSON / query |
| 401 | `unauthorized` | login required / bad credentials |
| 403 | `forbidden` | role lacks permission |
| 403 | `csrf_failed` | foreign Origin or missing/wrong `X-CSRF-Token` |
| 404 | `not_found` | unknown resource (also hidden/draft products for the public) |
| 409 | `conflict` | unique clash (slug, sku, code, email) |
| 409 | `price_changed` | POST /orders quote_hash mismatch; `details.quote` = fresh Quote |
| 409 | `out_of_stock` | stock or flash allocation ran out; `details.variant_ids` |
| 409 | `limit_reached` | coupon usage / per-customer / flash per-customer limit; `details.reason_code` |
| 409 | `idempotency_conflict` | same Idempotency-Key, different body |
| 409 | `invalid_state` | illegal order/payment status transition |
| 413 | `payload_too_large` | body over limit |
| 422 | `validation_failed` | field errors in `fields` |
| 429 | `rate_limited` | `Retry-After` header set |
| 501 | `not_implemented` | Wave-0 stub / deferred feature |
| 503 | `service_unavailable` | no database configured / dependency down |
| 500 | `internal` | anything else (no details leaked) |

### 1.3 Auth, session cookie, CSRF (escoma pattern)

- `POST /auth/login` sets cookie **`shopship_session`** = opaque 32-byte random token (base64url), `HttpOnly; Path=/; SameSite=Lax; Secure` (Secure off only when `COOKIE_SECURE=false` in dev). DB stores SHA-256 only. TTL `SESSION_TTL` (30 d), sliding `last_seen_at`.
- Each session has a `csrf_token`, returned in the login/register/me response body. The client keeps it in memory and sends **`X-CSRF-Token`** on every non-GET while signed in. Guests (no session) are protected by the Origin allowlist (`CORS_ALLOWED_ORIGINS`) + SameSite=Lax + JSON-only bodies.
- Guest cart cookie **`shopship_cart`** = cart uuid, `HttpOnly; SameSite=Lax; Secure; Max-Age=60d`. On login/register the guest cart is merged into the user's active cart (qty summed per variant, capped at stock and 999; guest coupon kept if the user cart has none) and the guest cart is marked `merged`; the cookie is cleared.
- Login rate limit: 5 / 10 min per IP and per email (`429`). Unknown email does a dummy argon2id verify (no user enumeration). Passwords: argon2id (`auth.HashPassword`), min 8 chars.
- One `users` table: `role` ∈ `customer | staff | admin | owner`. `/admin/*` requires staff+ (`401` no session, `403` customer).
- Webhooks (`/webhooks/...`) are outside session + CSRF middleware and verify their own secret/signature.

### 1.4 RBAC (back office)

| Permission | staff | admin | owner |
|---|:-:|:-:|:-:|
| `dashboard:read`, `catalog:read`, `inventory:write`, `orders:read`, `orders:fulfil`, `promotions:read` | ✓ | ✓ | ✓ |
| `catalog:write`, `orders:manage`, `promotions:write`, `customers:read`, `customers:write`, `banners:write`, `reviews:moderate`, `audit:read` | – | ✓ | ✓ |
| `staff:manage` (change any user's `role`) | – | – | ✓ |

`orders:fulfil` = `paid→packing→shipped`, create shipment. `orders:manage` = cancel/refund/any legal transition.
The last active owner cannot be demoted or deactivated (`409 conflict`). Every admin mutation writes `audit_logs`.

---

## 2. Shared object shapes

```ts
Money = int64 satang

Image        { id, url, alt, width, height }
CategoryRef  { id, slug, name }
Category     { id, slug, name, description, image_url, icon, parent_id: int|null, sort_order,
               product_count, children: Category[] }          // tree, max 2 levels
ProductCard  { id, slug, name, name_en?: string,                 // name_en: optional English name (additive, Wave 1)
               subtitle, brand, image: Image|null,
               min_price_satang, max_price_satang,             // PUBLIC list price range (active variants)
               flash: FlashBadge|null,                         // public flash price (same for everyone)
               rating_avg: number, rating_count, sold_count, in_stock: bool,
               badges: string[] }                              // e.g. ["ซื้อ 2 แถม 1"] from auto promotions targeting it
FlashBadge   { flash_sale_id, sale_price_satang, list_price_satang, ends_at, remaining_qty, lowest_30d_satang: Money|null }
Variant      { id, sku, name, option_values: {[option]: value}, price_satang, in_stock: bool,
               stock_level: "in_stock"|"low"|"out", image_id: int|null }   // exact stock never public
Product      ProductCard + { description (markdown), category: CategoryRef, breadcrumbs: CategoryRef[],
               options: [{name, values[]}], variants: Variant[], images: Image[],
               reviews_summary: ReviewsSummary, tags: string[], seo: {title, description} }
ReviewsSummary { rating_avg, rating_count, histogram: {"1":n,"2":n,"3":n,"4":n,"5":n}, with_images_count }
Review       { id, rating, title, body, author_name, variant_name, images: Image[], created_at,
               reply: {body, replied_at}|null }
Address      { id, label, recipient_name, phone, line1, line2, subdistrict, district, province,
               postal_code, country: "TH", is_default }
Me           { id, email, name, phone, role, tier, group: {id, code, name}|null, marketing_consent,
               email_verified: bool, created_at, perms: string[], csrf_token }
```

---

## 3. Public catalog

| Method | Path | Notes |
|---|---|---|
| GET | `/categories` | Tree of active categories `{data: Category[]}` |
| GET | `/categories/:slug` | `{data: Category}` incl. children + `breadcrumbs: CategoryRef[]` (root → self; implemented Wave 1) |
| GET | `/products` | Paginated `ProductCard[]` (see filters) |
| GET | `/products/:slug` | `{data: Product}`; 404 unless status=`active` |
| GET | `/products/:slug/reviews` | Paginated `Review[]`; `?rating=1..5`, `?with_images=true`, `?sort=newest|rating_desc|rating_asc` |
| GET | `/products/:slug/related` | `{data: ProductCard[]}` (≤ 12, same category, by sold_count) |
| GET | `/search/suggest?q=` | `{data: {products: [{slug, name, image_url}], categories: CategoryRef[]}}` ≤ 8 each |

`GET /products` query:

| Param | Type | Meaning |
|---|---|---|
| `q` | string ≤ 100 | Thai/English fuzzy search (see §3.1) |
| `category` | slug | includes the category's children |
| `min_price`, `max_price` | int satang | filter on `min_price_satang` |
| `rating_min` | 1..5 | `rating_avg >= n` |
| `in_stock` | bool | at least one active variant with stock > 0 |
| `tag` | string | exact tag |
| `on_sale` | bool | in a current flash sale or targeted by an active auto promotion |
| `sort` | enum | `relevance` (default when `q`), `newest` (default otherwise), `price_asc`, `price_desc`, `best_selling`, `rating` |
| `page`, `per_page` | int | per_page ≤ 48 |

### 3.1 Search (pg_trgm, verified on PG 17)
`products.search_text` = lower(name, subtitle, brand, tags, SKUs), GIN `gin_trgm_ops`. Query:
```sql
WHERE search_text ILIKE '%' || $q || '%'              -- exact substring (Thai has no spaces)
   OR $q <% search_text                               -- word_similarity >= pg_trgm.word_similarity_threshold (0.6 default; set 0.4 per tx)
ORDER BY (search_text ILIKE '%'||$q||'%') DESC, word_similarity($q, search_text) DESC, sold_count DESC
```
Escape `%`/`_` in `$q`. Verified: `word_similarity('เสื้อยึด', 'เสื้อยืดคอตตอนสีขาว') = 0.667` (typo ยืด→ยึด found).
**DB locale must be a UTF-8 locale (e.g. `en_US.UTF-8`)** — with `C`/`POSIX`/builtin `C.UTF-8` pg_trgm extracts zero
trigrams from Thai; migration 0001 aborts in that case.

---

## 4. Auth (`/auth`)

| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/register` | `{email, password, name, phone?, marketing_consent: bool}` → `201 {data: Me}` + cookies; `409 conflict` email taken |
| POST | `/auth/login` | `{email, password}` → `200 {data: Me}` + cookie; merges guest cart; `401` bad credentials; `403` deactivated |
| POST | `/auth/logout` | → `204`; deletes session, clears cookie |
| GET | `/auth/me` | → `{data: Me}` or `401` (storefront treats 401 as guest). Additive (Wave 2): `?optional=true` → guests get `200 {data: null}` instead of `401` (no failed request in the console) |
| PATCH | `/auth/me` | `{name?, phone?, marketing_consent?}` → `{data: Me}` |
| POST | `/auth/password/change` | `{current_password, new_password}` → `204`; other sessions revoked |
| POST | `/auth/password/forgot` | `{email}` → always `202` (email via `EMAIL_DRIVER`: log / file / resend — Wave 3) |
| POST | `/auth/password/reset` | `{token, new_password}` → `204`; single-use token (1 h), all sessions revoked |
| GET | `/auth/google/start` | **deferred** → `501` |

## 5. Account (`/me`, login required)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/me/addresses` | `{data: Address[]}` default first |
| POST | `/me/addresses` | Address fields (no id) → `201 {data: Address}`; first address becomes default; max 10 |
| PATCH | `/me/addresses/:id` | partial → `{data: Address}` |
| DELETE | `/me/addresses/:id` | `204` |
| POST | `/me/addresses/:id/default` | `{data: Address}` |
| GET | `/me/wishlist` | paginated `ProductCard[]` |
| PUT | `/me/wishlist/:product_id` | `204` (idempotent) |
| DELETE | `/me/wishlist/:product_id` | `204` |

Validation: `postal_code` `^[1-9][0-9]{4}$`, phone 9–15 digits after stripping spaces/dashes, Thai messages in `fields`.

---

## 6. Cart and quote (`/cart`, guest or member)

```ts
CartItem { variant_id, qty, product: {id, slug, name, image: Image|null}, variant: {sku, name, option_values},
           list_unit_price_satang, stock_level: "in_stock"|"low"|"out", max_qty: int }
Cart     { items: CartItem[], coupon_code: string|null, item_count: int, quote: Quote }
```

| Method | Path | Body → Response |
|---|---|---|
| GET | `/cart` | `{data: Cart}` (creates nothing; empty cart when no cookie) |
| POST | `/cart/items` | `{variant_id, qty}` → `{data: Cart}`; adds to existing qty; creates guest cart + cookie if needed; `409 out_of_stock` if qty > stock |
| PATCH | `/cart/items/:variant_id` | `{qty}` (1..999) → `{data: Cart}` |
| DELETE | `/cart/items/:variant_id` | `{data: Cart}` |
| PUT | `/cart/coupon` | `{code}` → `{data: Cart}`. Always `200`; validity is reported in `quote.coupon` (an invalid code is stored so the reason stays visible until removed) |
| DELETE | `/cart/coupon` | `{data: Cart}` |
| POST | `/cart/quote` | `{postal_code?: string, address_id?: int, coupon_code?: string}` → `{data: Quote}`. `coupon_code` overrides the stored one for this quote only. Shipping fee is 0 until a postal code/address is given. |

The quote is **non-binding** (`expires_at` = now + 10 min). `POST /orders` re-prices and compares `quote_hash`.

### 6.1 Quote (frozen; `api/internal/pricing/types.go`)

```ts
Quote {
  lines: QuoteLine[],
  adjustments: Adjustment[],         // cart-level (layers 3–4), one per applied rule
  shipping: { fee_satang, discount_satang, promotion_id?: int, label?: string },
  totals: { list_subtotal_satang,    // Σ qty × list price
            subtotal_satang,         // Σ line_total_satang (after layers 1–2)
            discount_satang,         // Σ adjustments
            shipping_satang,         // fee − shipping discount
            savings_satang,          // list_subtotal − subtotal + discount + shipping discount
            grand_total_satang },    // subtotal − discount + shipping
  coupon: { code, status: "applied"|"not_applied"|"invalid", reason_code: string, message: string } | null,
  hints: { kind: "free_shipping_gap"|"cart_promo_gap"|"buy_x_get_y_gap"|"login_for_member_price"|"quantity_break_gap",
           message: string, amount_satang?: int, promotion_id?: int,
           variant_id?: int, qty_needed?: int, unit_price_satang?: int, percent_bp?: int }[],   // last four: quantity_break_gap only (additive, Wave 1)
  quote_hash: string,                // hex sha256 of the canonical priced result
  expires_at: string
}
QuoteLine {
  variant_id, qty, list_unit_price_satang,
  unit_price_satang,                 // after layer 1
  price_source: { kind: "list"|"flash_sale"|"quantity_break"|"group_price"|"tier_price", label,
                  promotion_id?: int, flash_sale_item_id?: int },
  adjustments: Adjustment[],         // layer 2 (0 or 1)
  line_total_satang,                 // qty × unit_price − Σ line adjustments
  allocated_discount_satang,         // share of cart-level discounts (largest remainder) — for receipts/refunds
  lowest_30d_satang: int|null,       // strike-through reference (null when price_source = list)
  availability: { status: "ok"|"insufficient_stock"|"out_of_stock"|"unavailable", available_qty }
}
Adjustment { promotion_id, layer, label, amount_satang /* positive = money off */, coupon_code?: string }
```
Lines whose availability ≠ `ok` are priced at 0 qty for totals (shown, not charged) and block checkout.

### 6.2 Pricing rules (approved — implemented by `pricing.Price`, pure, `now` injected)

1. **Unit price (layer 1)** = lowest of: flash sale price · quantity-break (trade tier for the line qty) · group % · tier %. Never stacked. Percent → `round_half_up(list × (10000 − bp) / 10000)` on the **unit** price. Flash applies only while `sold_qty + qty ≤ qty_limit` and within the per-customer limit; otherwise the line falls back to the next best source (not split).
2. **Line promo (layer 2)** `buy_x_get_y`: one per line (best amount; ties priority desc, id asc), flash lines excluded. Free/discounted units are the cheapest units of the line (all units same price → `floor(qty/(buy+get)) × get` units).
3. **Cart automatic (layer 3)**: single best `cart_percent`/`cart_amount` whose `min_spend_satang` ≤ eligible subtotal (eligible = lines matching targets, after layers 1–2). `max_discount_satang` caps percent.
4. **Code (layer 4)**: one code per cart. Non-exclusive code stacks on top of layer 3. **Exclusive** code: compare with the layer-3 winner, keep the better (equal → keep the automatic one); the loser is reported via `coupon.status="not_applied", reason_code="exclusive_not_better"` (or layer 3 is dropped silently when the code wins). A `free_shipping` code competes in step 5.
5. **Shipping (layer 5)**: one free-shipping rule (auto layer 5 or a layer-4 free-shipping code), `discount_satang = fee` (or capped by `max_discount_satang`).

Ties: `priority` desc, then `id` asc. Each applied rule = one labelled `Adjustment`. Cart-level amounts are allocated
to eligible lines proportionally by largest remainder (Σ allocations = adjustment amount exactly).
**Strike-through** (`lowest_30d_satang`) = lowest list price in the 30 days before the winning promotion's start
(`variant_lowest_price_30d(variant_id, starts_at)` / `price_history`). Admins never type a compare-at price.
**Quantity-break hint** (additive, Wave 1): for a signed-in customer, each non-flash ok line whose next quantity-break
tier (smallest `min_qty` > line qty) would lower the unit price gets `kind="quantity_break_gap"` with `qty_needed`
(= min_qty − qty), `unit_price_satang` (the unlocked unit price), `percent_bp` (percent tiers only),
`variant_id` (the line) and `promotion_id`; one hint per line (nearest tier, then cheapest); message e.g. `หยิบเพิ่มอีก 2 ชิ้น รับราคาส่ง ลด 10% (฿225/ชิ้น)`.
**Login gating**: quantity-break, group, tier, per-customer limits and codes with `per_customer_limit` require login;
for guests they are skipped (code → `invalid/login_required`) and a `login_for_member_price` hint may be added.

### 6.3 Coupon reason codes
`not_found`, `inactive`, `not_started`, `expired`, `usage_limit_reached`, `per_customer_limit_reached`, `login_required`,
`not_eligible_audience`, `min_spend_not_met`, `no_eligible_items`, `exclusive_not_better`, `shipping_already_free`.
`status`: `invalid` for the first seven, `not_applied` for the rest, `applied` (reason_code `""`) otherwise.

---

## 7. Shipping

| Method | Path | Body → Response |
|---|---|---|
| POST | `/shipping/quote` | `{postal_code, weight_grams?}` (weight defaults to cart weight) → `{data: {carrier: "flash_mock", fee_satang, eta_days: [min, max]}}` |
| GET | `/orders/:order_no/tracking` | login; `{data: {carrier, tracking_no, status, events: [{status, description, location, occurred_at}]}}` — `events` newest first |

Mock adapter: flat `SHIPPING_FLAT_RATE_SATANG` (4000), ETA [1,3] (remote provinces [2,5]), tracking `TH` + 10 digits + `MK`.

## 8. Orders (login required)

```ts
OrderSummary { order_no, status, item_count, grand_total_satang, created_at, first_item_image: Image|null }
Order {
  order_no, status: "pending_payment"|"paid"|"packing"|"shipped"|"delivered"|"completed"|"cancelled"|"refunded",
  items: [{ variant_id, product_slug, sku, product_name, variant_name, image_url, qty,
            list_unit_price_satang, unit_price_satang, price_source: {kind, label},
            line_discount_satang, line_total_satang, allocated_discount_satang, lowest_30d_satang }],
  adjustments: Adjustment[],               // all applied rules incl. layer-2 lines (with order_item ref omitted)
  totals: { list_subtotal_satang, subtotal_satang, discount_satang, shipping_fee_satang,
            shipping_discount_satang, savings_satang, grand_total_satang },
  coupon_code: string|null, payment_method: "promptpay"|"card",
  shipping_address: Address-without-id, email, customer_note,
  payment: { status, method, charge_id, expires_at }|null,     // latest charge
  shipment: { carrier, tracking_no, status, label_url? }|null,
  timeline: [{ status, at, note }],
  payment_due_at, paid_at, cancelled_at, created_at
}
```

| Method | Path | Body → Response |
|---|---|---|
| POST | `/orders` | Header **`Idempotency-Key`** (8–100 chars, client uuid). Body `{address_id, payment_method, quote_hash, coupon_code?, customer_note?}` → `201 {data: Order}` |
| GET | `/orders` | paginated `OrderSummary[]`, `?status=` |
| GET | `/orders/:order_no` | `{data: Order}` (own orders only, else 404) |
| POST | `/orders/:order_no/cancel` | only `pending_payment` → `{data: Order}`; releases reservations/redemptions |

**POST /orders algorithm (one transaction, READ COMMITTED):**
1. Same user + same Idempotency-Key exists → same body ⇒ return the existing order `200`; different body ⇒ `409 idempotency_conflict`.
2. Load cart, ruleset, customer usage; `SELECT ... FROM product_variants WHERE id = ANY($ids) ORDER BY id FOR UPDATE` (lock in id order).
3. Re-price with `pricing.Price`; if `quote_hash` ≠ request → rollback, `409 price_changed`, `details.quote` = fresh quote.
4. Per line: `UPDATE product_variants SET stock = stock - $q WHERE id = $v AND stock >= $q` (0 rows ⇒ `409 out_of_stock`); flash lines also `UPDATE flash_sale_items SET sold_qty = sold_qty + $q WHERE id = $f AND sold_qty + $q <= qty_limit`.
5. Each applied promotion with a limit: `UPDATE promotions SET used_count = used_count + 1 WHERE id = $p AND (usage_limit IS NULL OR used_count < usage_limit)` (0 rows ⇒ `409 limit_reached`); insert `promotion_redemptions` (`reserved`); per-customer limits counted from redemptions with `status <> 'released'`.
6. Insert order, items, adjustments, `stock_reservations` (`held`, expires = now + 15 min = `payment_due_at`), status history; mark cart `converted`.
Payment success ⇒ reservations `committed`, redemptions `confirmed`, `sold_count` bumped. Expiry job (every minute) and
cancel ⇒ `UPDATE stock_reservations SET status='released' ... WHERE id=$1 AND status='held' RETURNING` and only then
restore stock / sold_qty / used_count (idempotent release).

## 9. Payments (mock provider mirroring Omise)

```ts
Charge { charge_id, order_no, method: "promptpay"|"card", status: "pending"|"requires_action"|"successful"|"failed"|"expired"|"refunded",
         amount_satang, promptpay: { qr_payload: string, qr_image_url: string|null, expires_at }|null,
         authorize_uri: string|null, failure_code: string|null, failure_message: string|null }
```

| Method | Path | Body → Response |
|---|---|---|
| POST | `/payments/charges` | login; `{order_no, method, card_token?, return_uri?}` → `201 {data: Charge}`. PromptPay → `pending` + EMVCo `qr_payload` (render client-side as QR). Card → `requires_action` + `authorize_uri` (3-DS-like step). Order must be `pending_payment`, else `409 invalid_state`. Re-calling returns the open charge. |
| GET | `/payments/charges/:charge_id` | login; poll every 3 s while pending → `{data: Charge}` |
| POST | `/payments/mock/charges/:charge_id/complete` | **mock only** (404 otherwise): `{outcome: "successful"|"failed"}` — simulates the payer; internally emits the same webhook event |
| GET | `/payments/mock/authorize/:charge_id` | **mock only**: simple HTML "3-D Secure" page with Approve/Decline → redirects to `return_uri` |
| POST | `/webhooks/payments/:provider` | provider webhook. Mock: header `X-Webhook-Secret: $PAYMENT_WEBHOOK_SECRET`, body `{id, type: "charge.complete", data: {id: charge_id}}`. Stored in `payment_webhook_events` (unique provider+event_id ⇒ duplicate = `200` no-op); the charge is re-fetched from the provider (never trust the body); already-final charge ⇒ no-op. Always `200` after storing. |

Mock card tokens (Wave 1, api-core): `tokn_test_success` → `successful` immediately; `tokn_test_3ds` **or no token** → `requires_action` + `authorize_uri`; `tokn_test_failure` → `failed` immediately (`failure_code: "payment_rejected"`).
The API **refuses to boot** with `PAYMENT_PROVIDER=mock` (or `SHIPPING_CARRIER=flash_mock`) when `APP_ENV=production`.

## 10. Promotions — public

| Method | Path | Response |
|---|---|---|
| GET | `/campaigns/active` | `{data: Campaign|null}` — highest-priority active campaign now. `Campaign {id, slug, name, season_tag, theme: {accent, accent_contrast, background, hero_image_url, badge_text}, starts_at, ends_at, banners: Banner[], promo_codes?: PromoCode[]}`; `PromoCode {code, label, description, ends_at: string|null}` (additive, Wave 1) — advertised codes of the campaign, priority desc. A code is advertised (derived, no column) when its layer-4 promotion has this `campaign_id`, `status=active`, has not ended (running or upcoming), usage not exhausted, no group/tier audience, and exactly one active code (batch-generated codes stay private). |
| GET | `/banners?placement=home_hero|home_strip|category_top&category=slug` | `{data: Banner[]}`; `Banner {id, placement, title, subtitle, cta_label, link_url, image_url, image_mobile_url, image_alt, campaign_id}` |
| GET | `/flash-sales/current` | `{data: {current: FlashSale|null, next: FlashSale|null}}`; `FlashSale {id, label, starts_at, ends_at, items: [{flash_sale_item_id, product: ProductCard, variant_id, variant_name, sale_price_satang, list_price_satang, lowest_30d_satang, qty_limit, sold_qty, remaining_qty, per_customer_limit}]}` (`next` without items' `sold_qty`) |
| GET | `/offers?variant_ids=1,2,3` | **no-store, session-aware**: `{data: [{variant_id, list_price_satang, price_satang, price_source: {kind, label}, lowest_30d_satang, qty_breaks: [{min_qty, unit_price_satang}], badges: string[]}]}` — personal unit price for qty 1 (member/trade/flash). ≤ 100 ids. |

## 11. Reviews (read only in MVP; writing deferred)
`GET /products/:slug/reviews` (§3). Review writing returns later as `POST /orders/:order_no/items/:id/review`.

---

## 12. Admin (`/admin`, staff session + CSRF; permission per row)

Admin lists accept `?page`, `?per_page` (≤100), `?q`, `?sort` and return `{data, meta}`. Mutations return the
updated object `{data: ...}`; deletes return `204`. Product/category "delete" = soft delete/archive when referenced.

### 12.1 Catalog
| Method | Path | Perm | Body → Response |
|---|---|---|---|
| GET | `/admin/products` | catalog:read | `?status, category_id, q, low_stock` → `AdminProductRow[] {id, slug, name, name_en, status, category: CategoryRef, image_url, min_price_satang, max_price_satang, total_stock, variant_count, updated_at}` |
| POST | `/admin/products` | catalog:write | `{name, name_en?, slug?, subtitle, description, category_id, brand, status, featured, tags[], options[], seo_title, seo_description, variants: [{sku, name, option_values, price_satang, cost_satang?, stock, weight_grams, barcode, low_stock_threshold}]}` → `201 AdminProduct` |
| GET | `/admin/products/:id` | catalog:read | `AdminProduct` = Product fields (incl. `name_en`, `""` when unset) + `status, featured, variants[] (with stock, cost_satang, low_stock_threshold, is_active), images[], created_at, updated_at` |
| PATCH | `/admin/products/:id` | catalog:write | partial product fields (incl. `name_en`) |
| DELETE | `/admin/products/:id` | catalog:write | soft delete |
| POST | `/admin/products/:id/variants` | catalog:write | variant fields → `201 AdminVariant` |
| PATCH | `/admin/variants/:id` | catalog:write | partial (price change auto-logged to price_history) |
| DELETE | `/admin/variants/:id` | catalog:write | deactivates if referenced by orders |
| GET | `/admin/variants/:id/price-history` | catalog:read | `[{price_satang, changed_at}]` |
| POST | `/admin/products/:id/images` | catalog:write | multipart `file` (jpeg/png/webp ≤ 8 MB), `alt`, `variant_id?` → `201 Image` |
| PUT | `/admin/products/:id/images/order` | catalog:write | `{image_ids: int[]}` |
| PATCH/DELETE | `/admin/images/:id` | catalog:write | `{alt?, variant_id?}` |
| GET/POST | `/admin/categories` | read / write | flat list with `parent_id`; body `{slug, name, parent_id?, description, image_url, icon, sort_order, is_active, seo_title, seo_description}` |
| PATCH/DELETE | `/admin/categories/:id` | catalog:write | delete refused (`409`) when it has products/children |
| GET | `/admin/inventory` | catalog:read | `?low_stock=true` → `[{variant_id, product_id, product_name, sku, variant_name, stock, low_stock_threshold, reserved_qty}]` |
| POST | `/admin/inventory/adjust` | inventory:write | `{variant_id, delta: int, reason}` → `{variant_id, stock}`; `UPDATE ... WHERE stock + delta >= 0` |
| GET | `/admin/reviews` | reviews:moderate | `?status, product_id, rating` |
| PATCH | `/admin/reviews/:id` | reviews:moderate | `{status?: "published"|"hidden", reply_body?}` |
| POST | `/admin/products/import` | catalog:write | **Wave 3, additive.** multipart `file` (CSV ≤ 8 MB, ≤ 5,000 rows) `?dry_run=true\|false` (default `true`) → `200 ImportReport`. Dry run executes the import inside a transaction and rolls it back (DB checks validated too). Real run = ONE transaction, all or nothing; any error → `422 validation_failed` with the `ImportReport` in `error.details`, nothing written. Imports are serialised (advisory lock). Upload-level problems (no file, `.xlsx`, no `handle` header, malformed CSV) → `422` with `fields.file`. One `audit_logs` row `product.import` per applied run (file name, sha256, summary, ids). See §12.1.1 |
| GET | `/admin/products/export.csv` | catalog:read | `?status?` → `text/csv` (UTF-8 + BOM, CRLF), every non-deleted product, one row per variant, in the import format (re-importing an unchanged export reports everything `skip`) |
| GET | `/admin/products/import/template.csv` | catalog:read | header + example rows (Thai, quoted commas, options, auto SKU, decimals) using a real category slug |

#### 12.1.1 Product CSV format (import/export)

One row per **variant**; rows with the same `handle` (= `products.slug`) belong to one product (rows need not be adjacent).
Encodings: UTF-8 with or without BOM, UTF-16 with BOM (Excel "Unicode Text"), and non-UTF-8 files are read as Windows-874
(Excel "CSV" on Thai Windows; a warning is added). Delimiter `,` (`;` or TAB auto-detected from the header). Header names
are case-insensitive; aliases `slug`→`handle`, `name`→`name_th`, `price`→`price_baht`, `category`→`category_slug`; unknown
columns are ignored with a warning. Spreadsheet row numbers: header = 1 (a quoted multi-line cell stays one row).

| Column | Level | Rule |
|---|---|---|
| `handle` | product | required, `^[a-z0-9]+(-[a-z0-9]+)*$` ≤ 120 (lower-cased). Upsert key: existing non-deleted product with this slug is updated, else created |
| `name_th`, `category_slug` | product | required for a NEW product; `category_slug` must exist (any level) |
| `name_en`, `subtitle`, `description`, `brand`, `seo_title`, `seo_description` | product | text (DB length limits) |
| `status` | product | `draft` (default for new) \| `active` \| `hidden` \| `archived` (Thai labels เผยแพร่/ซ่อน/ฉบับร่าง/เก็บถาวร accepted); `active` sets `published_at` once |
| `featured` | product | `true/false/1/0/yes/no/ใช่/ไม่` |
| `tags` | product | pipe-separated `a\|b` |
| `option1_name`/`option1_value` … `option3_*` | variant | e.g. `สี`/`ขาว`. A product with >1 row needs options on every row, same names in the same order; `products.options` = existing options + names/values first seen in the file |
| `sku` | variant | optional, `^[A-Za-z0-9._-]{1,64}$`, globally unique (case-insensitive, incl. soft-deleted products). Blank → matched to the existing variant with the same option values, else generated `HANDLE6-HASH3[-VAL…]` (hash of the full handle, digest for non-ASCII values, `-2`, `-3` … until unique vs DB + file) |
| `price_baht` | variant | required for a NEW variant. Decimal baht → satang, half-up at the 3rd decimal (`19.995` → 2000); `1,234.50`, `฿`, `บาท` ok; `1E+03`, negatives, `12,5` rejected; > 0 |
| `cost_baht` | variant | same parser, optional |
| `stock`, `low_stock_threshold`, `weight_grams` | variant | non-negative integers. `stock` SETS the sellable stock (absolute) |
| `barcode` | variant | ≤ 64 chars (format the column as Text in Excel to keep leading zeros) |
| `variant_active` | variant | bool, default `true` |
| `image_urls` | product | pipe-separated absolute `http(s)` URLs, stored as external images (`storage_key = ''`, not downloaded); URLs already on the product are skipped; others (relative paths) skipped with a warning; ≤ 30 images per product |

On update a **blank cell keeps the current value** (CSV cannot clear a field). Product-level values may repeat on every
row of the handle or appear once; two different non-blank values → error. Not in the model, so not in the format:
compare-at/list price (strike-through is derived from 30-day price history, §6.2) and trade/wholesale flags (customer
groups / quantity breaks in promotions). Cells starting with `=`, `+`, `@`, TAB, CR are exported with a leading `'`
(formula-injection guard) and the `'` is stripped on import.

```ts
ImportReport = {
  dry_run: boolean, applied: boolean, encoding: "utf-8"|"utf-8-bom"|"utf-16"|"windows-874",
  summary: { rows, products, products_create, products_update, products_skip,
             variants_create, variants_update, variants_skip, images_add, error_rows },  // a product with any variant change counts as update
  errors:   [{ row, column, message }],   // Thai; row 0 = whole file; capped at 1000 (truncated: true)
  warnings: [{ row, column, message }],
  rows: [{ row, handle, name, variant, sku, sku_generated, price_satang|null, stock|null,
           action: "create"|"update"|"skip"|"error", product_action, changes: string[] /* column names */ }],
  truncated: boolean
}
```

### 12.2 Promotions (all kinds)
```ts
AdminPromotion {
  id, name, label, description, kind, layer, status: "draft"|"active"|"paused"|"archived",
  starts_at, ends_at: string|null, priority, exclusive, auto_apply,
  percent_bp: int|null, amount_satang: int|null, buy_qty: int|null, get_qty: int|null, get_percent_bp: int|null,
  min_spend_satang, max_discount_satang: int|null, usage_limit: int|null, per_customer_limit: int|null, used_count,
  customer_group_ids: int[], tiers: ("standard"|"silver"|"gold"|"platinum")[],
  qty_tiers: [{min_qty, unit_price_satang: int|null, percent_bp: int|null}],     // quantity_break only
  targets: [{type: "category"|"product"|"variant", id, name}],                    // [] = whole store
  codes: [{id, code, is_active}],                                                  // layer 4 only
  campaign: {id, slug, name}|null, season_tag, created_at, updated_at,
  state: "scheduled"|"running"|"ended"|"draft"|"paused"|"archived"                // computed for the list UI
}
```
Allowed kind/layer/auto_apply combos (DB CHECK): L1 `quantity_break|group_price|tier_price` (auto) · L2 `buy_x_get_y`
(auto) · L3 `cart_percent|cart_amount` (auto) · L4 `cart_percent|cart_amount|free_shipping` (code, `auto_apply=false`,
`exclusive` allowed) · L5 `free_shipping` (auto). The admin form picks the *kind* + "needs a code?"; the API derives `layer`.
A **seasonal code** = L4 promotion with a window + `campaign_id`. **Trade tiers** = `quantity_break` (+ usually a trade customer group).

| Method | Path | Perm | Body → Response |
|---|---|---|---|
| GET | `/admin/promotions` | promotions:read | `?kind, layer, state, campaign_id, q` → `AdminPromotion[]` |
| POST | `/admin/promotions` | promotions:write | AdminPromotion writable fields + `codes?: string[]` → `201` |
| GET/PATCH/DELETE | `/admin/promotions/:id` | read / write | DELETE = archive when it has redemptions |
| POST | `/admin/promotions/:id/codes` | promotions:write | `{codes?: string[]}` or `{generate: {count ≤ 500, prefix, length}}` → `{data: [{id, code, is_active}]}` |
| DELETE | `/admin/coupon-codes/:id` | promotions:write | deactivate |
| GET | `/admin/promotions/:id/redemptions` | promotions:read | paginated `[{order_no, user_email, amount_satang, status, created_at}]` |
| POST | `/admin/promotions/preview` | promotions:read | `{lines: [{variant_id, qty}], coupon_code?, user_id?, postal_code?, now?}` → `{data: Quote}` (uses draft rules too) |
| GET/POST | `/admin/flash-sales` | read / write | `AdminFlashSale {id, name, label, status, starts_at, ends_at, campaign_id, items: [{id, variant_id, sku, product_name, variant_name, list_price_satang, sale_price_satang, qty_limit, sold_qty, per_customer_limit, sort_order}]}`; overlap of the same variant in two active sales ⇒ `409 conflict` |
| GET/PATCH/DELETE | `/admin/flash-sales/:id` | read / write | |
| PUT | `/admin/flash-sales/:id/items` | promotions:write | replace items `[{variant_id, sale_price_satang, qty_limit, per_customer_limit?, sort_order}]`; `sale_price < list price` required; cannot lower `qty_limit` below `sold_qty` |
| GET/POST | `/admin/campaigns` | read / write | `{slug, name, season_tag, theme, starts_at, ends_at, priority, is_active}` |
| PATCH/DELETE | `/admin/campaigns/:id` | promotions:write | |
| GET/POST | `/admin/customer-groups` | customers:read / write | `{code, name, description}` → `{id, code, name, description, member_count}` |
| PATCH/DELETE | `/admin/customer-groups/:id` | customers:write | delete sets members' group to null |

### 12.3 Users, orders, shipments, banners, dashboard, audit
| Method | Path | Perm | Body → Response |
|---|---|---|---|
| GET | `/admin/users` | customers:read | `?role, group_id, tier, q` (`role`: one role, `staff_all`, or a comma list such as `staff,admin,owner` — additive, Wave 2) → `[{id, email, name, phone, role, tier, group: {id, code, name}|null, is_active, order_count, total_spent_satang, created_at, last_login_at}]` |
| GET | `/admin/users/:id` | customers:read | user + `addresses[]`, `recent_orders: OrderSummary[]` |
| PATCH | `/admin/users/:id` | customers:write (`role` needs staff:manage) | `{group_id?: int|null, tier?, is_active?, role?}` |
| GET | `/admin/orders` | orders:read | `?status, q (order_no/email/phone), from, to` → `[{order_no, status, customer: {id, email, name}, item_count, grand_total_satang, payment_method, created_at, paid_at}]` |
| GET | `/admin/orders/:order_no` | orders:read | `Order` + `customer`, `payments[]`, `status_history[] {from_status, to_status, actor_email, note, created_at}`; additive (Wave 1, admin): `shipment.id?: int` so the console can call `/admin/shipments/:id/*` |
| POST | `/admin/orders/:order_no/status` | orders:fulfil (cancel/refund: orders:manage) | `{to, note?}`; legal moves: `paid→packing→shipped→delivered→completed`, `pending_payment→cancelled`, `paid|packing→cancelled` (refund via provider), `delivered|completed→refunded`; else `409 invalid_state` |
| POST | `/admin/orders/:order_no/shipments` | orders:fulfil | `{weight_grams?}` → `201 {id, carrier, tracking_no, status, label_url, fee_satang}`; order must be `packing`; sets order `shipped` |
| GET | `/admin/shipments/:id/label` | orders:fulfil | mock: PDF/HTML label |
| POST | `/admin/shipments/:id/mock-advance` | orders:fulfil | **mock carrier only** (`404` unless `SHIPPING_CARRIER=flash_mock`; additive, Wave 1): advances tracking one step `created → picked_up → in_transit → out_for_delivery → delivered` → `{data: Tracking}`; reaching `delivered` moves the order `shipped → delivered` |
| GET/POST | `/admin/banners` | banners:write | Banner writable fields + `starts_at, ends_at, is_active, sort_order, category_id` |
| PATCH/DELETE | `/admin/banners/:id` | banners:write | |
| POST | `/admin/uploads` | any write perm | multipart `file` → `201 {storage_key, url, width, height}` |
| GET | `/admin/dashboard` | dashboard:read | `{today: {sales_satang, orders, paid_orders}, month: {sales_satang, orders}, pending: {to_pack, pending_payment}, low_stock: [{variant_id, sku, product_name, stock}], sales_7d: [{date, sales_satang, orders}], top_products: [{product_id, name, qty, sales_satang}]}` (sales = paid+ statuses, Bangkok day boundaries) |
| GET | `/admin/audit-logs` | audit:read | `?actor_id, action, target_type, from, to` → `[{id, actor: {id, email}|null, action, target_type, target_id, metadata, ip, created_at}]` |

Carrier webhook: `POST /webhooks/shipping/:carrier` (mock: `X-Webhook-Secret`, body `{tracking_no, status, description, location, occurred_at}`; dedupe on (shipment, status, occurred_at); `delivered` ⇒ order `delivered`).

---

## 13. Deferred (stubs/mocks only in MVP)
Chat · Google login (`501`) · live Flash Express (flat-rate mock behind `shipping.Carrier`) · real Omise (mock behind
`payments.Provider`) · R2 (local disk behind `platform.Storage`, served at `/media/*`) · ~~email (log driver)~~ (real drivers + outbox in Wave 3) · ~~CSV import~~ (done in Wave 3, §12.1.1) ·
review writing · bundles · automatic tier upgrades · PWA offline.

---

## 14. Shop assistant (additive, Wave 3)

`POST /assistant/chat` — session optional (guest or member), Origin/CSRF like every V1 POST, `Cache-Control: no-store`.
Rate limit: `ASSISTANT_RATE_PER_MIN` (default 20) per IP and per signed-in user → `429 rate_limited` + `Retry-After`.
Guest order lookups (order number + email) are additionally limited to 5 per IP per 10 min (answered in the reply, not as 429).

```ts
ChatRequest  { messages: [{ role: "user"|"assistant", content: string }],   // oldest first; last must be "user" (≤ 500 chars);
                                                                          // server keeps the newest 10, older turns cut to 1000 chars
               context?: { product_slug?: string } }                       // page the shopper is on (enables "ตัวนี้…")
ChatResponse { reply: string,                    // Thai, plain text with "•" bullets and \n
               suggestions: string[],            // ≤ 4 quick-reply chips (send as the next user message)
               products: AssistantCard[],        // ≤ 6
               actions: [{ kind: "link", label, href }],   // e.g. /account/orders, /promotions, LINE/mailto hand-off
               source: "rules" | "llm" }
AssistantCard { slug, name, price_satang,        // PUBLIC price: public flash price when on flash sale, else min list price
                price_from: bool,                // variants differ in price ("เริ่มต้น")
                lowest_30d_satang: Money|null,   // only with on_flash_sale (strike-through rule §6.2)
                on_flash_sale: bool, image_url, in_stock: bool,
                variant_id: int|null }           // only when the product has exactly ONE active variant in stock (one-tap add to cart)
```
`422 validation_failed` (`fields.messages`) for empty/over-long/badly-shaped messages; `503` without a database.

Scoping (enforced server-side, whatever the brain asks for): catalog/promotions = what the public sees (no member, group,
tier or quantity-break prices; layer-1 promotions are never listed); orders = the signed-in user's own orders only, or
order number **and** order email for guests; message text is never logged. Brains: rule/intent engine (default, offline);
Claude Messages API tool use when `ANTHROPIC_API_KEY` is set (`ASSISTANT_MODEL` `claude-haiku-5-5` | `claude-sonnet-5-5`),
falling back to the rule engine on any error, timeout, refusal, or a reply quoting a money amount no tool returned.
Store-policy answers come from `api/internal/assistant/faq_th.md`.
