"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * Link that prefetches on intent (pointer over / touch start / keyboard focus) instead of on entering the viewport.
 * A product grid or the tab bar would otherwise fire a burst of RSC + route-JS prefetches during page load, competing
 * with the LCP image and adding main-thread work on phones. Navigation stays instant for the link the shopper aims at.
 */
export function IntentLink({ href, onPointerEnter, onTouchStart, onFocus, ...rest }: Omit<ComponentProps<typeof Link>, "prefetch" | "href"> & { href: string }) {
  const router = useRouter();
  const warm = () => router.prefetch(href);
  return (
    <Link
      href={href}
      prefetch={false}
      onPointerEnter={(e) => {
        warm();
        onPointerEnter?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}
