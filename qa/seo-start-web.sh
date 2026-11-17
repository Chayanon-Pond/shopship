#!/usr/bin/env bash
# Wave 3 SEO: production web (`next start`) on :3105 against the isolated API on :8099.
cd /d/shop/web
source /d/shop/qa/seo-env.sh
export PORT=3105
exec node node_modules/next/dist/bin/next start -p 3105
