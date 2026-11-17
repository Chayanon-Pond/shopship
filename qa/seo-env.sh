#!/usr/bin/env bash
# Wave 3 SEO isolated stack: embedded PG :55444 (api/data/devdb-seo), API :8099, web `next start` :3105.
# Does not touch the boss's stack (:3000 / :8080 / :55432) nor Nansy's w3 stack (:3103 / :8097 / :55442).
export GOTOOLCHAIN=local
export DATABASE_URL='postgres://shopship:shopship-dev-only@127.0.0.1:55444/shopship?sslmode=disable'
export PORT=8099
export APP_ENV=development
export COOKIE_SECURE=false
export PAYMENT_PROVIDER=mock
export SHIPPING_CARRIER=flash_mock
export PAYMENT_WEBHOOK_SECRET=dev-only-webhook-secret
export PUBLIC_BASE_URL=http://localhost:8099
export WEB_BASE_URL=http://localhost:3105
export CORS_ALLOWED_ORIGINS=http://localhost:3105
export MEDIA_DIR=/d/shop/api/data/media-seo
# web side
export API_URL=http://localhost:8099
export NEXT_PUBLIC_MEDIA_ORIGIN=http://localhost:8099
export NEXT_PUBLIC_SITE_URL=http://localhost:3105
export NEXT_PUBLIC_PAYMENT_MOCK=true
