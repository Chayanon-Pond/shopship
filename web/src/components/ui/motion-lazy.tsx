"use client";

import { LazyMotion, MotionConfig } from "motion/react";

const loadMax = () => import("./motion-features-max").then((r) => r.default);

/**
 * Motion runtime for interaction-heavy pages only (cart, checkout, pay, account): `m.*` components (strict) with the
 * features fetched lazily. The home / product / category routes do not import motion at all (CSS + Web Animations).
 */
export function MaxMotion({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadMax} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
