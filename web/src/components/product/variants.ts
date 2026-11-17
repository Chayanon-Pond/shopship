/** Pure variant-selection helpers (unit-tested in variants.test.ts). */
import type { Product, Variant } from "../../lib/api/types.ts";

export type Selection = Record<string, string>;

export function initialSelection(p: Pick<Product, "options" | "variants">, preferVariantId?: number): Selection {
  const v =
    (preferVariantId ? p.variants.find((x) => x.id === preferVariantId) : undefined) ??
    p.variants.find((x) => x.in_stock) ??
    p.variants[0];
  if (!v) return {};
  const sel: Selection = {};
  for (const o of p.options) if (v.option_values[o.name]) sel[o.name] = v.option_values[o.name];
  return sel;
}

export function findVariant(p: Pick<Product, "options" | "variants">, sel: Selection): Variant | undefined {
  if (!p.options.length) return p.variants[0];
  return p.variants.find((v) => p.options.every((o) => v.option_values[o.name] === sel[o.name]));
}

/** "in" = some in-stock variant has this value given the other current choices; "out" = exists but sold out; "none" = no such combination. */
export function valueState(p: Pick<Product, "options" | "variants">, sel: Selection, option: string, value: string): "in" | "out" | "none" {
  const next = { ...sel, [option]: value };
  const matches = p.variants.filter((v) => p.options.every((o) => !next[o.name] || v.option_values[o.name] === next[o.name]));
  if (!matches.length) {
    // fall back to "does this value exist at all"
    return p.variants.some((v) => v.option_values[option] === value && v.in_stock) ? "in" : p.variants.some((v) => v.option_values[option] === value) ? "out" : "none";
  }
  return matches.some((v) => v.in_stock) ? "in" : "out";
}

/** Choosing a value that has no exact combination keeps it and snaps the other options to the closest in-stock variant. */
export function choose(p: Pick<Product, "options" | "variants">, sel: Selection, option: string, value: string): Selection {
  const next = { ...sel, [option]: value };
  if (findVariant(p, next)) return next;
  const alt = p.variants.find((v) => v.option_values[option] === value && v.in_stock) ?? p.variants.find((v) => v.option_values[option] === value);
  if (!alt) return next;
  const out: Selection = {};
  for (const o of p.options) out[o.name] = alt.option_values[o.name];
  return out;
}

/** Colour swatch for common Thai/English colour names (decorative; the name is always shown too). */
export function swatch(value: string): string | null {
  const map: Record<string, string> = {
    ขาว: "#f5f5f0",
    ดำ: "#1d1d1f",
    กรมท่า: "#1f2a44",
    เทา: "#8e8e93",
    เงิน: "#d9d9de",
    น้ำเงิน: "#1d4ed8",
    ฟ้า: "#7cc4f5",
    ส้ม: "#ff7a1a",
    แดง: "#d70015",
    เขียว: "#2f8f4e",
    ชมพู: "#f7a1c4",
    สีธรรมชาติ: "#e8dcc4",
  };
  return map[value] ?? null;
}
