"use client";

import dynamic from "next/dynamic";
import { useConsent } from "@/components/store/consent";

// The banner/sheet UI is fetched only for visitors who still have to decide (or reopen settings): returning visitors
// download none of it. It renders after hydration as a fixed overlay, so it never shifts the layout.
const ConsentPanel = dynamic(() => import("./cookie-consent-panel").then((r) => r.ConsentPanel), { ssr: false });

export function CookieConsent() {
  const { ready, decided, settingsOpen } = useConsent();
  if (!ready || (decided && !settingsOpen)) return null;
  return <ConsentPanel />;
}
