# ShopShip — deploy on Railway (API + web + Postgres in one project)

Why one Railway project: the web server talks to the API over Railway's private network (no public hop, no CORS),
one bill, Postgres next to the API (Singapore). Vercel Hobby forbids commercial use (a shop needs Pro, +$20/mo) and
would add a cross-provider hop for every API call.

Until real Omise / Flash Express keys exist, deploy as **staging** (`APP_ENV=staging`): the API refuses the mock
payment provider and mock carrier when `APP_ENV=production` (by design).

## 1. Project + services
1. Railway → New Project → Deploy from GitHub → `Chayanon-Pond/shopship` (branch `main`). Region: Singapore.
2. That first service = **api**: Settings → Source → Root Directory `/api`, Config file `/api/railway.json`.
3. New → GitHub repo again → same repo = **web**: Root Directory `/web`, Config file `/web/railway.json`.
4. New → Database → **PostgreSQL** (default locale en_US.UTF-8 is required for Thai search — do not use a C locale).
5. api → Settings → Networking → Generate Domain. web → Generate Domain. (Custom domain later.)
6. api → Volumes → Add volume, mount path `/data` (product photos live in `/data/media`).

## 2. api variables
| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_ENV` | `staging` (→ `production` only with real Omise + Flash keys) |
| `PORT` | `8080` |
| `MIGRATE_ON_START` | `true` |
| `COOKIE_SECURE` | `true` |
| `PAYMENT_PROVIDER` / `SHIPPING_CARRIER` | `mock` / `flash_mock` (staging) |
| `PAYMENT_WEBHOOK_SECRET` | long random string (`openssl rand -hex 32`) |
| `CORS_ALLOWED_ORIGINS` | `https://<web domain>` |
| `WEB_BASE_URL` | `https://<web domain>` |
| `PUBLIC_BASE_URL` | `https://<api domain>` |
| `TRUSTED_PROXIES` | `fd12::/16` (Railway private network, so the web proxy's client-IP header is trusted) |
| `STORAGE_DRIVER` / `MEDIA_DIR` | `local` / `/data/media` |
| `RAILWAY_RUN_UID` | `0` (the image runs as non-root; Railway volumes mount as root) |
| `EMAIL_DRIVER` | `log` now → `resend` + `RESEND_API_KEY` + `EMAIL_FROM` when the domain is verified |
| `ANTHROPIC_API_KEY` | optional — chatbot uses the Thai rule engine without it |

## 3. web variables (NEXT_PUBLIC_* are baked at build time — redeploy after changing)
| Variable | Value |
|---|---|
| `API_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080` |
| `NEXT_PUBLIC_SITE_URL` | `https://<web domain>` |
| `NEXT_PUBLIC_MEDIA_ORIGIN` | `https://<api domain>` |
| `NEXT_PUBLIC_PAYMENT_MOCK` | `true` on staging (shows the test-payment buttons), unset in production |
| `CLIENT_IP_HEADER` | `x-real-ip` |
| `GOOGLE_SITE_VERIFICATION` | optional (Search Console) |

## 4. First data (staging only; the owner runs these — they write to the Railway database)
Postgres → Connect → copy the **public** connection URL, then on your machine:
```bash
cd api
DATABASE_URL='<public url>' GOTOOLCHAIN=local go run ./cmd/server seed-demo        # demo catalog + logins (refuses APP_ENV=production)
ADMIN_PASSWORD='<strong password>' DATABASE_URL='<public url>' GOTOOLCHAIN=local go run ./cmd/server create-admin --email <you> --name "<name>" --role owner
```
For a real launch skip `seed-demo`; create the owner, then import products with the admin CSV import.

## 5. Check
- `https://<api domain>/readyz` → `{"status":"ready"}`
- `https://<web domain>/` loads with products; login works (cookie is first-party on the web domain via the proxy)
- Submit `https://<web domain>/sitemap_index.xml` in Google Search Console once on the real domain.
