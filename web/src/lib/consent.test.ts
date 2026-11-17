import assert from "node:assert/strict";
import { test } from "node:test";
import { CONSENT_COOKIE, consentCookieString, parseConsent, readConsentCookie, serializeConsent } from "./consent.ts";

test("serialize / parse round trip", () => {
  const v = serializeConsent({ analytics: true, marketing: false }, Date.UTC(2026, 10, 17, 6, 0, 0, 999));
  assert.equal(v, "v1.a1.m0.1794895200");
  assert.deepEqual(parseConsent(v), { necessary: true, analytics: true, marketing: false, decidedAt: 1794895200000 });
  assert.deepEqual(parseConsent(serializeConsent({ analytics: false, marketing: true }, 0)), { necessary: true, analytics: false, marketing: true, decidedAt: 0 });
});

test("rejects missing, malformed and outdated values", () => {
  for (const bad of [null, undefined, "", "yes", "v1.a2.m0.1", "v1.a1.m0.", "v0.a1.m1.1", "v2.a1.m1.1", "v1.a1.m1.1 ; x"]) assert.equal(parseConsent(bad), null, String(bad));
});

test("reads the cookie out of document.cookie", () => {
  assert.equal(readConsentCookie(""), null);
  assert.equal(readConsentCookie("shopship_cart=abc; other=1"), null);
  assert.equal(readConsentCookie(`a=1; ${CONSENT_COOKIE}=v1.a0.m0.5; b=2`)?.analytics, false);
  assert.equal(readConsentCookie(`${CONSENT_COOKIE}x=v1.a1.m1.5`), null);
});

test("cookie string: 1 year, first-party, Secure only on https", () => {
  assert.equal(consentCookieString("v1.a0.m0.5", false), "shopship_consent=v1.a0.m0.5; Max-Age=31536000; Path=/; SameSite=Lax");
  assert.match(consentCookieString("v1.a0.m0.5", true), /; Secure$/);
});
