#!/usr/bin/env bash
# Wave 3 isolated stack: embedded PG :55442 (api/data/devdb-w3), API :8097, web `next start` :3103.
# Does not touch the boss's stack (:3000 / :8080 / :55432). Local mock-only values.
export GOTOOLCHAIN=local
export DATABASE_URL='postgres://shopship:shopship-dev-only@127.0.0.1:55442/shopship?sslmode=disable'
export PORT=8097
export APP_ENV=development
export COOKIE_SECURE=false
export PAYMENT_PROVIDER=mock
export SHIPPING_CARRIER=flash_mock
export PAYMENT_WEBHOOK_SECRET=dev-only-webhook-secret
export PUBLIC_BASE_URL=http://localhost:8097
export WEB_BASE_URL=http://localhost:3103
export CORS_ALLOWED_ORIGINS=http://localhost:3103
export MEDIA_DIR=/d/shop/api/data/media-w3
# web side
export API_URL=http://localhost:8097
export NEXT_PUBLIC_MEDIA_ORIGIN=http://localhost:8097
export NEXT_PUBLIC_SITE_URL=http://localhost:3103
export NEXT_PUBLIC_PAYMENT_MOCK=true
