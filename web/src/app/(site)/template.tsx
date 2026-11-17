"use client";

import { useEffect, useState } from "react";

let hydrated = false;

/**
 * Page transition: client navigations fade + lift the new page in (CSS `.fx-page-in`, transform/opacity only).
 * The very first (server-rendered) page is NOT animated, so LCP and no-JS stay intact.
 */
export default function SiteTemplate({ children }: { children: React.ReactNode }) {
  const [animate] = useState(() => hydrated);
  useEffect(() => {
    hydrated = true;
  }, []);
  return <div className={animate ? "fx-page-in" : undefined}>{children}</div>;
}
