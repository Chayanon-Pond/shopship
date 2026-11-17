// Run: npm run test   (node:test with built-in TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { clampInput, isExternal, MAX_INPUT, placementFor, productSlug, safeHref, toHistory, type ChatItem } from "./chat-lib.ts";

test("toHistory drops local bubbles, keeps the newest 10 and starts with a user turn", () => {
  const items: ChatItem[] = [{ id: 0, role: "assistant", text: "welcome", local: true }];
  for (let i = 1; i <= 12; i++) items.push({ id: i, role: i % 2 ? "user" : "assistant", text: `m${i}` });
  items.push({ id: 99, role: "user", text: "last" });
  const h = toHistory(items);
  assert.ok(h.length <= 10);
  assert.equal(h[0].role, "user");
  assert.deepEqual(h.at(-1), { role: "user", content: "last" });
  assert.ok(!h.some((m) => m.content === "welcome"));
});

test("productSlug reads /p/[slug]", () => {
  assert.equal(productSlug("/p/white-tee"), "white-tee");
  assert.equal(productSlug("/p/%E0%B8%81"), "ก");
  assert.equal(productSlug("/c/shirts"), undefined);
});

test("placementFor hides on checkout and lifts above sticky bars", () => {
  assert.deepEqual(placementFor("/checkout"), { hidden: true, lift: "none" });
  assert.deepEqual(placementFor("/checkout/pay/SS1"), { hidden: true, lift: "none" });
  assert.equal(placementFor("/p/x").lift, "always");
  assert.equal(placementFor("/cart").lift, "below-lg");
  assert.deepEqual(placementFor("/"), { hidden: false, lift: "none" });
});

test("links: only same-site paths and hand-off schemes", () => {
  assert.equal(safeHref("/account/orders"), "/account/orders");
  assert.equal(safeHref("https://line.me/R/ti/p/@shop"), "https://line.me/R/ti/p/@shop");
  assert.equal(safeHref("mailto:support@shopship.example"), "mailto:support@shopship.example");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("//evil.example"), null);
  assert.equal(safeHref("http://plain.example"), null);
  assert.ok(isExternal("mailto:a@b.c") && !isExternal("/promotions"));
});

test("clampInput counts Thai code points", () => {
  assert.equal(Array.from(clampInput("ก".repeat(MAX_INPUT + 20))).length, MAX_INPUT);
});
