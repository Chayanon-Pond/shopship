#!/usr/bin/env bash
# Rebuild + restart the API on :8090 (kills the old one by port).
set -e
cd /d/shop/api
GOTOOLCHAIN=local go build -o /d/shop/qa/bin/server.exe ./cmd/server
pid=$(netstat -ano | grep ":8090 " | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID $pid //F > /dev/null || true
sleep 1
source /d/shop/qa/env.sh
nohup /d/shop/qa/bin/server.exe serve >> /d/shop/qa/api.log 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:8090/api/v1/categories > /dev/null && echo "api up" && exit 0; sleep 1; done
echo "api failed"; exit 1
