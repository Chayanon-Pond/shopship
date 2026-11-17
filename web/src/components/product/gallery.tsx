"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Image } from "@/lib/api/types";
import { useSlideChange } from "@/components/ui/fx";
import { useSwipe } from "@/components/ui/swipe";
import { Img } from "@/components/ui/primitives";

/** Product gallery: swipe/drag between images, thumbnails, hover-zoom (desktop), full-screen viewer with pinch zoom (mobile). */
export function Gallery({
  images,
  index,
  onIndex,
  mainRef,
  name,
}: {
  images: Image[];
  index: number;
  onIndex: (i: number) => void;
  mainRef: React.RefObject<HTMLDivElement | null>;
  name: string;
}) {
  const [dir, setDir] = useState(0);
  const [viewer, setViewer] = useState(false);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const n = images.length;
  const go = (d: number) => {
    setDir(d);
    onIndex((index + d + n) % n);
  };
  const cur = images[index] ?? images[0];
  const slide = useSlideChange(index);
  const { follow: swipeRef, handlers: swipeHandlers } = useSwipe((d) => go(d), { enabled: n > 1, distance: 50, velocity: 0.35 });

  return (
    <div className="flex flex-col-reverse gap-3 md:flex-row">
      {n > 1 ? (
        <ul className="no-scrollbar flex gap-2 overflow-x-auto md:max-h-[560px] md:flex-col md:overflow-y-auto" aria-label="รูปสินค้า">
          {images.map((im, i) => (
            <li key={im.id}>
              <button
                type="button"
                onClick={() => {
                  setDir(i > index ? 1 : -1);
                  onIndex(i);
                }}
                aria-label={`ดูรูปที่ ${i + 1}`}
                aria-current={i === index}
                className={clsx(
                  "relative block size-16 overflow-hidden rounded-[12px] bg-canvas-alt transition md:size-[72px]",
                  i === index ? "ring-2 ring-ink" : "opacity-70 hover:opacity-100",
                )}
              >
                <Img src={im.url} alt="" fill sizes="72px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        ref={mainRef}
        className="relative aspect-square flex-1 cursor-zoom-in overflow-hidden rounded-[24px] bg-canvas-alt"
        onMouseMove={(e) => {
          if (!window.matchMedia("(hover:hover) and (pointer:fine)").matches) return;
          const r = e.currentTarget.getBoundingClientRect();
          setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        onMouseLeave={() => setZoom(null)}
        onClick={() => setViewer(true)}
        {...swipeHandlers}
      >
        <div ref={swipeRef} className="absolute inset-0">
        {/* outgoing slide (kept until its CSS exit animation ends) + incoming slide; direction from `dir` */}
        {slide.prev !== null && images[slide.prev] && slide.prev !== index ? (
          <div key={`out-${images[slide.prev].id}`} className={clsx("absolute inset-0", dir < 0 ? "fx-gal-out-prev" : "fx-gal-out-next")} onAnimationEnd={slide.done} aria-hidden>
            <Img src={images[slide.prev].url} alt="" fill sizes="(min-width:1024px) 560px, 100vw" draggable={false} className="select-none object-cover" />
          </div>
        ) : null}
        <div key={cur?.id ?? 0} className={clsx("absolute inset-0 touch-pan-y", slide.changed && (dir > 0 ? "fx-gal-in-next" : dir < 0 ? "fx-gal-in-prev" : "fx-fade-in"))}>
            {cur ? (
              <Img
                src={cur.url}
                alt={cur.alt || name}
                fill
                fetchPriority="high"
                loading="eager"
                sizes="(min-width:1024px) 560px, 100vw"
                draggable={false}
                className="select-none object-cover transition-transform duration-300 ease-out"
                style={zoom ? { transform: "scale(1.9)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
              />
            ) : null}
        </div>
        </div>
        <span className="pointer-events-none absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-white/80 backdrop-blur" aria-hidden>
          <ZoomIn className="size-4" />
        </span>
        {n > 1 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5 md:hidden" aria-hidden>
            {images.map((im, i) => (
              <span key={im.id} className={clsx("h-1.5 rounded-pill transition-all", i === index ? "w-4 bg-ink" : "w-1.5 bg-ink/25")} />
            ))}
          </div>
        ) : null}
      </div>
      {viewer ? <Viewer images={images} start={index} name={name} onClose={() => setViewer(false)} /> : null}
    </div>
  );
}

function Viewer({ images, start, name, onClose }: { images: Image[]; start: number; name: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => (x + 1) % images.length);
      if (e.key === "ArrowLeft") setI((x) => (x - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", onKey);
    const o = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    box.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.style.overflow = o;
    };
  }, [images.length, onClose]);
  return createPortal(
    <div
      ref={box}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`รูปสินค้า ${name}`}
      className="fx-fade-in fixed inset-0 z-[95] flex flex-col bg-white outline-none"
    >
      <div className="flex items-center justify-between p-4">
        <span className="text-sm text-ink-2 tabular-nums">
          {i + 1} / {images.length}
        </span>
        <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full bg-canvas-alt" aria-label="ปิด">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="relative flex-1 overflow-auto [touch-action:pinch-zoom_pan-x_pan-y]">
        <div className="relative mx-auto aspect-square max-h-full w-full max-w-[min(100%,85dvh)]">
          <Img src={images[i].url} alt={images[i].alt || name} fill sizes="100vw" className="object-contain" />
        </div>
      </div>
      {images.length > 1 ? (
        <div className="flex justify-center gap-4 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => setI((x) => (x - 1 + images.length) % images.length)} className="grid size-11 place-items-center rounded-full bg-canvas-alt" aria-label="รูปก่อนหน้า">
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button type="button" onClick={() => setI((x) => (x + 1) % images.length)} className="grid size-11 place-items-center rounded-full bg-canvas-alt" aria-label="รูปถัดไป">
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
