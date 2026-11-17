// Copies the golden fixtures (source of truth: ../docs/fixtures/*.json) into
// src/mocks/fixtures/ so the web build (Docker context = web/) can bundle them
// for NEXT_PUBLIC_USE_MOCKS=true. Run after editing docs/fixtures:
//   npm run sync:fixtures
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "docs", "fixtures");
const dst = join(here, "..", "src", "mocks", "fixtures");
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (!f.endsWith(".json")) continue;
  copyFileSync(join(src, f), join(dst, f));
  n++;
}
console.log(`synced ${n} fixtures -> src/mocks/fixtures`);
