#!/usr/bin/env bash
# Stop API + dev DB, wipe api/data (devdb + media), start a fresh embedded PG, migrate, seed, start API.
cd /d/shop/api
pid=$(netstat -ano | grep ":8090 " | grep LISTENING | awk '{print $5}' | head -1); [ -n "$pid" ] && taskkill //PID $pid //F > /dev/null
[ -x ./data/devdb/runtime/bin/pg_ctl.exe ] && ./data/devdb/runtime/bin/pg_ctl.exe stop -D ./data/devdb/data -m fast
taskkill //IM devdb.exe //F > /dev/null 2>&1
sleep 2
rm -rf ./data
