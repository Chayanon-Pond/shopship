import assert from "node:assert/strict";
import { test } from "node:test";
import type { Product } from "../../lib/api/types.ts";
import { choose, findVariant, initialSelection, valueState } from "./variants.ts";

const v = (id: number, s: string, z: string, in_stock: boolean) => ({
  id, sku: `${s}-${z}`, name: `${s} / ${z}`, option_values: { สี: s, ไซซ์: z }, price_satang: 59000, in_stock, stock_level: in_stock ? "in_stock" : "out", image_id: null,
}) as Product["variants"][number];
const p = {
  options: [{ name: "สี", values: ["ขาว", "กรมท่า"] }, { name: "ไซซ์", values: ["M", "L"] }],
  variants: [v(205, "ขาว", "M", false), v(206, "ขาว", "L", true), v(207, "กรมท่า", "M", false), v(208, "กรมท่า", "L", true)],
};

test("initial selection = first in-stock variant", () => {
  assert.deepEqual(initialSelection(p), { สี: "ขาว", ไซซ์: "L" });
  assert.deepEqual(initialSelection(p, 208), { สี: "กรมท่า", ไซซ์: "L" });
});
test("findVariant matches every option", () => {
  assert.equal(findVariant(p, { สี: "กรมท่า", ไซซ์: "M" })?.id, 207);
  assert.equal(findVariant({ options: [], variants: [p.variants[1]] }, {})?.id, 206);
});
test("valueState marks sold-out combinations", () => {
  assert.equal(valueState(p, { สี: "ขาว", ไซซ์: "L" }, "ไซซ์", "M"), "out");
  assert.equal(valueState(p, { สี: "ขาว", ไซซ์: "L" }, "สี", "กรมท่า"), "in");
});
test("choose keeps the picked value", () => {
  assert.deepEqual(choose(p, { สี: "ขาว", ไซซ์: "L" }, "สี", "กรมท่า"), { สี: "กรมท่า", ไซซ์: "L" });
});
