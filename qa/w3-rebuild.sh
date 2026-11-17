#!/usr/bin/env bash
# Wave 3: rebuild web against the isolated API (:8097) and restart `next start` on :3103.
set -e
cd /d/shop/web
source /d/shop/qa/w3-env.sh
npm run build > /d/shop/qa/web-build-w3.log 2>&1 || { tail -40 /d/shop/qa/web-build-w3.log; exit 1; }
pid=$(netstat -ano | grep ":3103 " | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID $pid //F //T > /dev/null || true
sleep 1
nohup bash /d/shop/qa/w3-start-web.sh > /d/shop/qa/web-w3.log 2>&1 &
for i in $(seq 1 40); do curl -sf -o /dev/null localhost:3103/login && echo "web up" && exit 0; sleep 1; done
echo "web failed"; exit 1
