// Cached Thai formatters. `x.toLocaleString("th-TH", …)` builds a new Intl formatter on every call, which is slow on
// phones (it showed up as render time in product grids / reviews); these are created once per module.

const num = new Intl.NumberFormat("th-TH");
const date = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });

/** 1,234 / 1.5 in Thai grouping. */
export const thNumber = (n: number) => num.format(n);
/** 17 พ.ย. 2569 (Bangkok time). */
export const thDate = (iso: string) => date.format(new Date(iso));
