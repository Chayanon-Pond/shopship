#!/usr/bin/env bash
# QA env for the real local stack (API on :8090, web on :3000). Local mock-only values.
export GOTOOLCHAIN=local
export DATABASE_URL='postgres://shopship:shopship-dev-only@127.0.0.1:55432/shopship?sslmode=disable'
export PORT=8090
export APP_ENV=development
export COOKIE_SECURE=false
export PAYMENT_PROVIDER=mock
export SHIPPING_CARRIER=flash_mock
export PAYMENT_WEBHOOK_SECRET=dev-only-webhook-secret
export PUBLIC_BASE_URL=http://localhost:8090
export WEB_BASE_URL=http://localhost:3000
export CORS_ALLOWED_ORIGINS=http://localhost:3000
export MEDIA_DIR=/d/shop/api/data/media
