"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IntentLink as Link } from "@/components/ui/intent-link";
import { useCallback, useEffect, useState } from "react";
import type { Banner } from "@/lib/api/types";
import { useReducedMotionPref, useSlideChange } from "@/components/ui/fx";
import { useSwipe } from "@/components/ui/swipe";
import { Img } from "@/components/ui/primitives";

/** Swipeable promo banner carousel: drag/swipe, arrows, dots, autoplay (paused on hover/focus/hidden tab, off for reduced motion). */
export function BannerCarousel({ banners }: { banners: Banner[] }) {
  const [[i, dir], setI] = useState<[number, number]>([0, 0]);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotionPref();
  const slide = useSlideChange(i);
  const n = banners.length;
  const go = useCallback((d: number) => setI(([x]) => [(x + d + n) % n, d]), [n]);
  const { follow: swipeRef, handlers: swipeHandlers } = useSwipe(go, { enabled: n > 1, distance: 60, velocity: 0.4, elastic: 0.18 });

  useEffect(() => {
    if (n < 2 || paused || reduce) return;
    const t = setInterval(() => document.visibilityState === "visible" && go(1), 6000);
    return () => clearInterval(t);
  }, [n, paused, reduce, go]);

  if (!n) return null;
  const b = banners[i];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="โปรโมชันแนะนำ"
      className="container-page"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] bg-canvas-alt sm:aspect-[16/9] lg:aspect-[21/8]">
        <div ref={swipeRef} className="absolute inset-0 cursor-grab touch-pan-y active:cursor-grabbing" {...swipeHandlers}>
        {slide.prev !== null && banners[slide.prev] ? (
          <div key={`out-${banners[slide.prev].id}`} className={clsx("absolute inset-0", dir >= 0 ? "fx-ban-out-next" : "fx-ban-out-prev")} onAnimationEnd={slide.done} aria-hidden>
            <SlideBody b={banners[slide.prev]} eager={false} />
          </div>
        ) : null}
        <div
          key={b.id}
          className={clsx("absolute inset-0", slide.changed && (dir >= 0 ? "fx-ban-in-next" : "fx-ban-in-prev"))}
          role="group"
          aria-roledescription="slide"
          aria-label={`${i + 1} จาก ${n}: ${b.title}`}
        >
          <SlideBody b={b} eager={i === 0} animateText={slide.changed} />
        </div>
        </div>
        {n > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="แบนเนอร์ก่อนหน้า"
              className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/70 text-ink backdrop-blur transition hover:bg-white md:grid"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="แบนเนอร์ถัดไป"
              className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/70 text-ink backdrop-blur transition hover:bg-white md:grid"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </>
        ) : null}
      </div>
      {n > 1 ? (
        <div className="mt-4 flex justify-center gap-2" role="tablist" aria-label="เลือกแบนเนอร์">
          {banners.map((x, k) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={k === i}
              aria-label={`แบนเนอร์ ${k + 1}`}
              onClick={() => setI([k, k > i ? 1 : -1])}
              className="grid h-6 place-items-center"
            >
              <span className={clsx("block h-2 rounded-pill transition-all duration-500", k === i ? "w-6 bg-ink" : "w-2 bg-hairline hover:bg-ink-3")} />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** One banner: image, scrim and copy. On a slide change the copy rises in with a stagger (CSS, `fx-rise` + delay). */
function SlideBody({ b, eager, animateText }: { b: Banner; eager: boolean; animateText?: boolean }) {
  const rise = (delay: string) => (animateText ? { className: "fx-rise", style: { animationDelay: delay } } : { className: "", style: undefined });
  const h = rise("0.25s");
  const p = rise("0.35s");
  const c = rise("0.45s");
  return (
    <>
      <Img
        src={b.image_url}
        alt={b.image_alt || b.title}
        fill
        sizes="(min-width:1240px) 1200px, 100vw"
        className="pointer-events-none select-none object-cover"
        draggable={false}
        loading={eager ? "eager" : "lazy"}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent sm:bg-gradient-to-r sm:from-white/85 sm:via-white/30 sm:to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:inset-y-0 sm:left-0 sm:right-auto sm:flex sm:max-w-[56%] sm:flex-col sm:justify-center sm:p-12 sm:text-ink md:pl-20">
        <h2 style={h.style} className={clsx(h.className, "text-[30px] font-semibold leading-tight tracking-[-0.025em] sm:text-[40px] lg:text-[52px]")}>
          {b.title}
        </h2>
        {b.subtitle ? (
          <p style={p.style} className={clsx(p.className, "mt-2 text-base opacity-90 sm:text-xl sm:text-ink-2")}>
            {b.subtitle}
          </p>
        ) : null}
        {b.cta_label ? (
          <div style={c.style} className={clsx(c.className, "mt-5")}>
            <Link href={b.link_url || "/"} className="btn bg-white text-ink hover:bg-white/90 sm:bg-accent sm:text-white sm:hover:bg-accent-hover" draggable={false}>
              {b.cta_label}
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}
