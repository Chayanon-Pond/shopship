# ShopShip

ShopShip is a single-shop e-commerce site for Thailand. Spec: [docs/SPEC.md](docs/SPEC.md) (Thai).
API contract (frozen for Wave 1): [docs/API.md](docs/API.md). Agent ownership: [docs/WAVES.md](docs/WAVES.md).
Golden fixtures / frontend mocks: [docs/fixtures/](docs/fixtures/).

| Folder | Stack |
|---|---|
| `web/` | Next.js 16.4.6 + TypeScript + Tailwind 4 (CSS-first tokens in `src/app/globals.css`) + Motion — storefront `(site)` + `/admin` |
| `api/` | Go 1.25.6 + Gin + pgx + goose (embedded migrations) |

## Run locally

```bash
# web (mock data, no API needed)
cd web && npm install && NEXT_PUBLIC_USE_MOCKS=true npm run dev     # http://localhost:3000
# web against the API
cd web && API_URL=http://localhost:8080 npm run dev

# api (always use the local toolchain)
cd api && GOTOOLCHAIN=local go run ./cmd/server                     # http://localhost:8080/healthz
cd api && DATABASE_URL=postgres://... GOTOOLCHAIN=local go run ./cmd/server migrate up
```

Env vars: `api/.env.example`, `web/.env.example`. Without `DATABASE_URL` the API still boots (`/readyz` = 503).
Payments (`PAYMENT_PROVIDER=mock`) and shipping (`SHIPPING_CARRIER=flash_mock`) are mocks; the API refuses to start
with either mock when `APP_ENV=production`.

## Tests

```bash
cd api && GOTOOLCHAIN=local go test ./...     # incl. embedded PostgreSQL 17 (no Docker): migrations up/down/up + schema smoke
cd web && npm test && npm run lint && npm run build
```

The first Go test run downloads the PostgreSQL 17 binaries to `~/.embedded-postgres-go`. Set
`SHOPSHIP_TEST_DATABASE_URL` to use an existing server instead.

## Deploy

Railway (Singapore). Two services, `web/` and `api/`, each built from its own `Dockerfile` and `railway.json`.
Branches: `Develop` → PR → `main`. The Postgres database must use a UTF-8 locale (Thai trigram search).
