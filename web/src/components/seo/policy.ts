/**
 * Shop policies as stated on /legal/returns and /legal/shipping. Structured data must say exactly what those
 * pages say: change both together.
 *
 * The free-shipping threshold is the automatic layer-5 promotion (seeded "ส่งฟรี 990", min_spend 99000 satang).
 * The public API does not expose promotion rules, so it is configured here and overridable per deploy with
 * SEO_FREE_SHIPPING_MIN_SATANG (empty or "off" = never claim free shipping in structured data).
 */
const raw = process.env.SEO_FREE_SHIPPING_MIN_SATANG;
export const FREE_SHIPPING_MIN_SATANG: number | null =
  raw === undefined ? 99000 : /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;

/** /legal/returns: cooling-off 7 days from receipt, full refund, returned by mail; defects: we pay return shipping. */
export const RETURNS = { days: 7, path: "/legal/returns" } as const;

/** /legal/shipping: Thailand only, Flash Express; handling 1–2 business days, transit 1–3 (remote areas 2–5). */
export const SHIPPING = {
  country: "TH",
  carrier: "Flash Express",
  handlingDays: [1, 2],
  transitDays: [1, 5],
  path: "/legal/shipping",
} as const;
