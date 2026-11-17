/**
 * Money helpers. The API sends every amount as an integer number of SATANG
 * (1 THB = 100 satang) in fields ending in `_satang`. Never do float
 * arithmetic on baht: keep satang integers and format only at the edge.
 */

export type Satang = number;

const group = new Intl.NumberFormat("th-TH", { useGrouping: true, maximumFractionDigits: 0 });

export type BahtFormat = {
  /** "auto" (default): show .xx only when satang ≠ 0; "always": always 2 decimals; "never": round half-up to whole baht. */
  decimals?: "auto" | "always" | "never";
  /** Prefix "฿" (default true). */
  symbol?: boolean;
  /** Render a leading "+"/"−" ("−" U+2212) for non-zero values, e.g. discounts. */
  signed?: boolean;
};

/** formatBaht(123450) === "฿1,234.50"; formatBaht(21100) === "฿211". */
export function formatBaht(satang: Satang, opts: BahtFormat = {}): string {
  const { decimals = "auto", symbol = true, signed = false } = opts;
  if (!Number.isSafeInteger(satang)) throw new TypeError(`formatBaht: not an integer satang amount: ${satang}`);
  const neg = satang < 0;
  let abs = Math.abs(satang);
  if (decimals === "never") abs = Math.floor((abs + 50) / 100) * 100;
  const baht = Math.floor(abs / 100);
  const st = abs % 100;
  let s = group.format(baht);
  if (decimals === "always" || (decimals === "auto" && st !== 0)) s += "." + String(st).padStart(2, "0");
  if (symbol) s = "฿" + s;
  if (neg) return "−" + s;
  if (signed && satang > 0) return "+" + s;
  return s;
}

/** Discount line helper: formatDiscount(15550) === "−฿155.50". */
export function formatDiscount(satang: Satang): string {
  return satang === 0 ? formatBaht(0) : "−" + formatBaht(Math.abs(satang));
}

/**
 * Parse an admin-typed baht string ("1,234.5", "฿99", "1234.50") into satang
 * without floating point. Returns null when invalid or more than 2 decimals.
 */
export function parseBahtToSatang(input: string): Satang | null {
  const s = input.trim().replace(/^฿/, "").replace(/,/g, "").trim();
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(2, "0");
  return Number(m[1]) * 100 + Number(frac);
}

/** Percent from basis points for display: bpToPercent(1250) === "12.5%". */
export function formatBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  return (rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`) + "%";
}
