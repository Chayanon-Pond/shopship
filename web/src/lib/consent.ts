// PDPA cookie consent: pure parse/serialize of the first-party consent cookie (no DOM here; see components/store/consent.tsx).

export const CONSENT_COOKIE = "shopship_consent";
/** 1 year, in seconds. */
export const CONSENT_MAX_AGE = 31536000;
/** Bump when the categories or the cookie policy change materially: older choices are asked again. */
export const CONSENT_VERSION = 1;

export type ConsentCategory = "necessary" | "analytics" | "marketing";

export type Consent = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  /** when the visitor decided (ms since epoch, UTC) */
  decidedAt: number;
};

/** Cookie value: `v1.a1.m0.<unix seconds>`. Returns null for missing, malformed or outdated values. */
export function parseConsent(value: string | null | undefined): Consent | null {
  const m = /^v(\d+)\.a([01])\.m([01])\.(\d{1,12})$/.exec(value ?? "");
  if (!m || Number(m[1]) !== CONSENT_VERSION) return null;
  return { necessary: true, analytics: m[2] === "1", marketing: m[3] === "1", decidedAt: Number(m[4]) * 1000 };
}

export function serializeConsent(c: Pick<Consent, "analytics" | "marketing">, now: number): string {
  return `v${CONSENT_VERSION}.a${c.analytics ? 1 : 0}.m${c.marketing ? 1 : 0}.${Math.floor(now / 1000)}`;
}

/** Reads our cookie out of a `document.cookie` string. */
export function readConsentCookie(cookieHeader: string): Consent | null {
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === CONSENT_COOKIE) return parseConsent(decodeURIComponent(part.slice(i + 1).trim()));
  }
  return null;
}

/** Full Set-Cookie style string for `document.cookie = ...`. */
export function consentCookieString(value: string, secure: boolean): string {
  return `${CONSENT_COOKIE}=${encodeURIComponent(value)}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
}
