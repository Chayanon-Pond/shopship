#!/usr/bin/env bash
# Rebuild the production web bundle against the local API and restart `next start` on :3000.
set -e
cd /d/shop/web
export API_URL=http://localhost:8090 NEXT_PUBLIC_MEDIA_ORIGIN=http://localhost:8090 NEXT_PUBLIC_SITE_URL=http://localhost:3000 NEXT_PUBLIC_PAYMENT_MOCK=true
npm run build > /d/shop/qa/web-build.log 2>&1 || { tail -40 /d/shop/qa/web-build.log; exit 1; }
pid=$(netstat -ano | grep ":3000 " | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID $pid //F //T > /dev/null || true
sleep 1
nohup /d/shop/qa/start-web.sh > /d/shop/qa/web.log 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null localhost:3000/login && echo "web up" && exit 0; sleep 1; done
echo "web failed"; exit 1
