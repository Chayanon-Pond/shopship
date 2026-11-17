# ShopShip — Wave plan and file ownership

Wave 0 (foundation, done 2026-11-17 by Mark): schema, contract, fixtures, deps, route stubs, design tokens.
Wave 1 runs **four agents in parallel**. Each agent edits ONLY the paths it owns. Anything else = ask the coordinator.

## Hard rules (all agents)

1. **Contract is frozen**: `docs/API.md`, `api/internal/pricing/types.go` (JSON shape), `web/src/lib/api/types.ts`,
   `docs/fixtures/*.json`. Additive optional fields are OK *after* updating API.md + types.ts + fixtures in the same
   change and telling the coordinator. No renames/removals.
2. **Only the coordinator edits** `api/internal/http/router.go`, `api/internal/platform/*`, `api/cmd/server/main.go`,
   `api/go.mod`/`go.sum`, `web/package.json`/`package-lock.json`, `web/next.config.ts`, `web/tsconfig.json`,
   `web/src/app/layout.tsx`, `web/src/app/globals.css` (tokens), `web/src/lib/api/client.ts`,
   `web/src/app/api/v1/[...path]/route.ts`. Need a dependency or a token? Ask; do not `go get` / `npm install`.
3. **Only api-core owns migrations** from now on. New files are numbered after Wave 0's last (`0005_content.sql`):
   `0006_*.sql`, `0007_*.sql`, … Never edit a shipped migration. The pricing agent requests schema changes from api-core.
4. Domain packages add routes **only inside their own `Register` function** (the route table already exists; replace
   `httpx.NotImplemented` with real handlers; keep paths/methods).
5. Money is int64 satang end to end; percentages are basis points. No floats for money anywhere (Go or TS).
6. `GOTOOLCHAIN=local` for every Go command (go.mod is `go 1.25.6`; newer x/* or goose releases require Go 1.26 and
   would silently switch toolchains). No git commit/push, no deploy, no real keys, no external accounts.
7. Gates before handing back: `go build ./... && go vet ./... && go test ./...` (api) and `npm run build && npm run lint && npm test` (web).

## Ownership

### pricing (Go)
| Owns | Notes |
|---|---|
| `api/internal/pricing/**` | Pure engine `Price(cart, ruleset, ctx) -> Quote`. No I/O, no `time.Now()`. Table-driven tests incl. all 4 fixture scenarios (build inputs that reproduce each fixture; every money/label/coupon/hint field must match — `quote_hash`, `expires_at` and `available_qty` may differ), rounding half-up, largest-remainder allocation, ties (priority desc, id asc), exclusive-code comparison, lowest_30d. Fuzz/property test: Σ allocations = discount, totals identity. |
| `api/internal/promotions/**` | Ruleset loader (SQL → `pricing.Ruleset`, customer usage), redemption guards (`used_count` conditional UPDATE, per-customer counts), public `/campaigns/active`, `/banners`, `/flash-sales/current`, `/offers`; admin promotions/codes/flash-sales/campaigns/customer-groups/preview. Exposes `promotions.Loader` for cart/orders. |

### api-core (Go)
| Owns | Notes |
|---|---|
| `api/internal/{auth,account,catalog,cart,orders,payments,shipping,admin,httpx,ratelimit,config}/**` | Sessions/CSRF (escoma pattern), argon2id (`auth.HashPassword` exists), guest cart + merge, `POST /cart/quote` (calls promotions loader + `pricing.Price`), checkout transaction (§8 of API.md), reservations + expiry job, mock payment provider (Omise-shaped) + webhook, flat-rate mock carrier, admin catalog/orders/users/banners/uploads/dashboard/audit. |
| `api/migrations/**` (new files only, `0006_` onward) and `api/internal/testdb/**` | |
| `api/cmd/server` subcommands **other than** the existing `serve`/`migrate` | e.g. `create-admin`, `seed-demo` — coordinate the main.go switch edit. |

Interface between pricing and api-core (frozen now):
`pricing.Price(pricing.Cart, pricing.Ruleset, pricing.Context) (pricing.Quote, error)`; promotions exposes
`LoadRuleset(ctx, q pgx.Tx|*pgxpool.Pool, cart pricing.Cart, customer *pricing.Customer, now time.Time) (pricing.Ruleset, pricing.Context, error)`
and `Redeem(ctx, tx, quote, orderID, userID) error` / `Release(ctx, tx, orderID) error`. If a different signature is
needed, pricing defines it and tells api-core before api-core codes against it.

### storefront (web)
| Owns |
|---|
| `web/src/app/(site)/**` (all public pages + `(site)/layout.tsx`), `web/src/components/**` except `components/admin/**` and `components/placeholder.tsx` (shared), `web/src/lib/api/storefront.ts`, `web/src/lib/{site,catalog}.ts` (catalog.ts = prototype sample data, delete when unused), `web/src/app/{robots,sitemap,manifest}.ts`, `web/public/**` (except `public/mock/**`). |

Rules: cached server components render the **public list price only** (`min_price_satang`, public flash price);
member/trade prices (`/offers`), cart, quote, me, orders are fetched client-side with `no-store`. Under
cacheComponents: read `params`/`searchParams` inside `<Suspense>` (see `components/placeholder.tsx`), real 404s via
`notFound()` outside Suspense where SEO matters (escoma soft-404 gotcha). Gate on `next build`.

### admin (web)
| Owns |
|---|
| `web/src/app/admin/**`, `web/src/components/admin/**`, `web/src/lib/api/admin.ts`, `web/src/lib/admin/**`. |

Rules: every page is client-data (no-store); session gate in `app/admin/(console)/layout.tsx` (401 → `/admin/login`,
customer → 403 page); hide UI by `me.perms` but the API is the real check; money inputs via `parseBahtToSatang`.
Must work on iPad (packing station).

### Shared (any agent may ADD, never change existing exports without the coordinator)
`web/src/lib/money.ts` (+ tests), `web/src/mocks/handler.ts` (add routes for new fixtures), `docs/fixtures/generate.py`
(regenerate with `python docs/fixtures/generate.py docs/fixtures` then `cd web && npm run sync:fixtures`).

## Hand-off checklist (each agent)
- List of files changed, gates run with output, deviations from API.md (should be none), open questions.
