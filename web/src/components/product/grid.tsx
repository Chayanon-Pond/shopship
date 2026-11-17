"use client";

import { clsx } from "clsx";
import { Reveal } from "@/components/ui/motion";
import { useOffers } from "@/components/store/personal";
import type { ProductCard } from "@/lib/api/types";
import { ProductTile, TileSkeleton } from "./tile";

export const gridCols = "grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4 xl:gap-x-5";

/** Product grid with staggered scroll-reveal. `variants` (slug → default variant id) enables quick add + personal prices. */
export function ProductGrid({
  products,
  variants,
  personal,
  className,
  cols = gridCols,
  priorityCount = 0,
}: {
  products: ProductCard[];
  variants?: Record<string, number>;
  personal?: boolean;
  className?: string;
  cols?: string;
  priorityCount?: number;
}) {
  const ids = personal && variants ? products.map((p) => variants[p.slug]).filter(Boolean) : [];
  const offers = useOffers(ids);
  return (
    <ul className={clsx(cols, className)}>
      {products.map((p, i) => {
        const tile = <ProductTile p={p} variantId={variants?.[p.slug]} offer={variants ? offers.get(variants[p.slug]) : undefined} priority={i < priorityCount} />;
        // priority (above-the-fold) tiles paint immediately: a scroll-in reveal would hold the LCP image at opacity 0 until hydration
        return i < priorityCount ? (
          <li key={p.id} className="h-full">
            {tile}
          </li>
        ) : (
          // tiles past the first rows skip rendering until scrolled near (content-visibility), see globals.css .cv-tile
          <Reveal as="li" key={p.id} delay={(i % 4) * 0.07} className={i >= 4 ? "cv-tile h-full" : "h-full"}>
            {tile}
          </Reveal>
        );
      })}
    </ul>
  );
}

export function GridSkeleton({ count = 8, cols = gridCols }: { count?: number; cols?: string }) {
  return (
    <ul className={cols} aria-busy="true" aria-label="กำลังโหลดสินค้า">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <TileSkeleton />
        </li>
      ))}
    </ul>
  );
}

/** Horizontal snap rail (mobile swipe, desktop arrows-free scroll). */
export function ProductRail({ products, variants, personal }: { products: ProductCard[]; variants?: Record<string, number>; personal?: boolean }) {
  const ids = personal && variants ? products.map((p) => variants[p.slug]).filter(Boolean) : [];
  const offers = useOffers(ids);
  return (
    <ul className="no-scrollbar -mx-[var(--page-gutter)] flex snap-x snap-mandatory scroll-px-[var(--page-gutter)] gap-3 overflow-x-auto px-[var(--page-gutter)] pb-2 sm:gap-4">
      {products.map((p, i) => (
        <Reveal as="li" key={p.id} delay={Math.min(i, 5) * 0.06} className="w-[46%] shrink-0 snap-start sm:w-[31%] md:w-[23%] lg:w-[18.5%]">
          <ProductTile p={p} variantId={variants?.[p.slug]} offer={variants ? offers.get(variants[p.slug]) : undefined} />
        </Reveal>
      ))}
    </ul>
  );
}
