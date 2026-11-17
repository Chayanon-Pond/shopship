"use client";

import { useSyncExternalStore } from "react";
import { consentCookieString, readConsentCookie, serializeConsent, type Consent, type ConsentCategory } from "@/lib/consent";

/*
 * Cookie consent store (no provider needed): the choice lives in the first-party cookie `shopship_consent` (1 year),
 * this module caches the parsed value and notifies subscribers. Analytics/marketing code must check
 * `hasConsent("analytics")` / `useConsent().consent?.marketing` before loading anything.
 */
type State = { consent: Consent | null; settingsOpen: boolean };
const subs = new Set<() => void>();
let raw: string | null = null;
let state: State = { consent: null, settingsOpen: false };

function read(): State {
  const c = document.cookie;
  if (c !== raw) {
    raw = c;
    state = { ...state, consent: readConsentCookie(c) };
  }
  return state;
}
function emit(next: Partial<State>) {
  state = { ...read(), ...next };
  subs.forEach((f) => f());
}
function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}

function save(choice: { analytics: boolean; marketing: boolean }) {
  const value = serializeConsent(choice, Date.now());
  document.cookie = consentCookieString(value, window.location.protocol === "https:");
  raw = null; // re-parse on next read
  emit({ settingsOpen: false });
  window.dispatchEvent(new CustomEvent("shopship:consent", { detail: read().consent }));
}

export const consentActions = {
  acceptAll: () => save({ analytics: true, marketing: true }),
  rejectAll: () => save({ analytics: false, marketing: false }),
  save,
  openSettings: () => emit({ settingsOpen: true }),
  closeSettings: () => emit({ settingsOpen: false }),
};

/** Non-React check (e.g. before injecting a tag). Necessary is always allowed. */
export function hasConsent(cat: ConsentCategory) {
  if (cat === "necessary") return true;
  if (typeof document === "undefined") return false;
  return !!read().consent?.[cat];
}

type Snap = State & { ready: boolean };
const SERVER: Snap = { consent: null, settingsOpen: false, ready: false };
let clientSnap: Snap | null = null;
function snapshot() {
  const s = read();
  if (!clientSnap || clientSnap.consent !== s.consent || clientSnap.settingsOpen !== s.settingsOpen) clientSnap = { ...s, ready: true };
  return clientSnap;
}

/**
 * `consent`: null until the visitor decided (or before hydration — check `ready`). `decided` = a valid choice exists.
 * Actions: acceptAll / rejectAll / save({analytics, marketing}) / openSettings / closeSettings.
 */
export function useConsent() {
  const s = useSyncExternalStore(subscribe, snapshot, () => SERVER);
  return { ...s, decided: !!s.consent, ...consentActions };
}

/** Footer / page link that reopens the consent settings sheet. */
export function CookieSettingsButton({ className, children = "ตั้งค่าคุกกี้" }: { className?: string; children?: React.ReactNode }) {
  return (
    <button type="button" onClick={consentActions.openSettings} className={className}>
      {children}
    </button>
  );
}
