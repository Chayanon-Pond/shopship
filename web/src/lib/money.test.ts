// Run: npm run test   (node:test with built-in TypeScript type stripping)
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBaht, formatBp, formatDiscount, parseBahtToSatang } from "./money.ts";

test("formatBaht", () => {
  assert.equal(formatBaht(123450), "฿1,234.50");
  assert.equal(formatBaht(21100), "฿211");
  assert.equal(formatBaht(21100, { decimals: "always" }), "฿211.00");
  assert.equal(formatBaht(15550, { decimals: "never" }), "฿156");
  assert.equal(formatBaht(5), "฿0.05");
  assert.equal(formatBaht(0), "฿0");
  assert.equal(formatBaht(-990), "−฿9.90");
  assert.equal(formatBaht(100000000, { symbol: false }), "1,000,000");
  assert.throws(() => formatBaht(1.5));
});

test("formatDiscount", () => {
  assert.equal(formatDiscount(15550), "−฿155.50");
});

test("parseBahtToSatang", () => {
  assert.equal(parseBahtToSatang("1,234.5"), 123450);
  assert.equal(parseBahtToSatang("฿99"), 9900);
  assert.equal(parseBahtToSatang("0.07"), 7);
  assert.equal(parseBahtToSatang("1.234"), null);
  assert.equal(parseBahtToSatang("abc"), null);
  assert.equal(parseBahtToSatang("-5"), null);
});

test("formatBp", () => {
  assert.equal(formatBp(1000), "10%");
  assert.equal(formatBp(1250), "12.5%");
  assert.equal(formatBp(5), "0.05%");
});
