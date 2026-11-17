#!/usr/bin/env bash
# Wave 3: production web (`next start`) on :3103 against the isolated API on :8097.
cd /d/shop/web
source /d/shop/qa/w3-env.sh
export PORT=3103
exec node node_modules/next/dist/bin/next start -p 3103
