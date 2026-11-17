import { launch, newClient, sleep, uiLogin, text } from "./lib.mjs";
const b = await launch();
const { page } = await newClient(b);
await uiLogin(page, "gold", "/p/canvas-tote-bag");
await sleep(2500);
const t = await text(page);
console.log(t.includes("สมาชิก Gold ลด 5%") ? "PASS gold PDP shows member price label" : "FAIL gold PDP", (t.match(/฿[\d,.]+/g) || []).slice(0, 4).join(" "));
await b.close();
