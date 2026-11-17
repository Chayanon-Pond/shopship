"use client";

import { clsx } from "clsx";
import type { Product } from "@/lib/api/types";
import { choose, findVariant, swatch, valueState, type Selection } from "./variants";

export function VariantPicker({
  product,
  sel,
  onChange,
}: {
  product: Pick<Product, "options" | "variants">;
  sel: Selection;
  onChange: (s: Selection) => void;
}) {
  const v = findVariant(product, sel);
  if (!product.options.length) return null;
  return (
    <div className="space-y-5">
      {product.options.map((o) => (
        <fieldset key={o.name}>
          <legend className="mb-2 text-sm">
            <span className="font-semibold">{o.name}</span>
            <span className="text-ink-2"> · {sel[o.name] ?? "เลือก"}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {o.values.map((val) => {
              const st = valueState(product, sel, o.name, val);
              const on = sel[o.name] === val;
              const color = swatch(val);
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => onChange(choose(product, sel, o.name, val))}
                  disabled={st === "none"}
                  aria-pressed={on}
                  aria-label={`${val}${st === "out" ? " หมด" : ""}`}
                  className={clsx(
                    "relative inline-flex min-h-11 items-center gap-2 overflow-hidden rounded-[12px] border px-4 text-[15px] transition active:scale-95",
                    on ? "border-accent ring-1 ring-accent" : "border-hairline hover:border-ink-3",
                    st === "out" && "text-ink-2",
                    st === "none" && "cursor-not-allowed opacity-40",
                  )}
                >
                  {color ? <span className="size-5 rounded-full ring-1 ring-black/10" style={{ background: color }} aria-hidden /> : null}
                  <span className={clsx(st === "out" && "line-through decoration-1")}>{val}</span>
                  {st === "out" ? <span className="text-[11px] text-ink-2 no-underline">หมด</span> : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      {v ? (
        <p className={clsx("text-sm", v.stock_level === "out" ? "text-danger" : v.stock_level === "low" ? "text-warning" : "text-success")} aria-live="polite">
          {v.stock_level === "out" ? "ตัวเลือกนี้สินค้าหมดชั่วคราว" : v.stock_level === "low" ? "เหลือไม่กี่ชิ้น — รีบสั่งก่อนหมด" : "มีสินค้า พร้อมส่ง"}
        </p>
      ) : null}
    </div>
  );
}
