#!/usr/bin/env bash
# Start the production web build against the local API (:8090). CLIENT_IP_HEADER lets the QA harness emulate distinct client IPs (like x-real-ip on Railway).
cd /d/shop/web
export API_URL=http://localhost:8090 NEXT_PUBLIC_MEDIA_ORIGIN=http://localhost:8090 NEXT_PUBLIC_SITE_URL=http://localhost:3000 PORT=3000 CLIENT_IP_HEADER=x-real-ip
exec node node_modules/next/dist/bin/next start
