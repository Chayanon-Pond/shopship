"use client";

import { clsx } from "clsx";
import { MessageSquareReply } from "lucide-react";
import { useState } from "react";
import * as api from "@/lib/api/storefront";
import type { ListEnvelope, Review, ReviewsSummary } from "@/lib/api/types";
import { Img, Skeleton, Stars } from "@/components/ui/primitives";
import { Reveal } from "@/components/ui/motion";
import { thNumber, thDate } from "@/lib/intl";

type Filter = { rating?: number; with_images?: boolean };

export function Reviews({ slug, summary, initial }: { slug: string; summary: ReviewsSummary; initial: ListEnvelope<Review> }) {
  const [filter, setFilter] = useState<Filter>({});
  const [list, setList] = useState(initial.data);
  const [meta, setMeta] = useState(initial.meta);
  const [loading, setLoading] = useState(false);

  async function load(f: Filter, page = 1) {
    setLoading(true);
    try {
      const r = await api.getReviews(slug, { ...f, page });
      setList((l) => (page === 1 ? r.data : [...l, ...r.data]));
      setMeta(r.meta);
    } catch {
      /* keep current */
    } finally {
      setLoading(false);
    }
  }
  const pick = (f: Filter) => {
    setFilter(f);
    void load(f);
  };
  const total = summary.rating_count;
  const chips: { label: string; f: Filter; on: boolean }[] = [
    { label: "ทั้งหมด", f: {}, on: !filter.rating && !filter.with_images },
    { label: `มีรูป (${summary.with_images_count})`, f: { with_images: true }, on: !!filter.with_images },
    ...[5, 4, 3, 2, 1].map((r) => ({ label: `${r} ดาว`, f: { rating: r }, on: filter.rating === r })),
  ];

  return (
    <section id="reviews" aria-labelledby="reviews-title" className="cv-section scroll-mt-28">
      <h2 id="reviews-title" className="text-[28px] font-semibold tracking-[-0.02em] md:text-[36px]">
        รีวิวจากผู้ซื้อ
      </h2>
      {total === 0 ? (
        <p className="mt-4 rounded-tile bg-canvas-alt p-8 text-center text-ink-2">ยังไม่มีรีวิวสำหรับสินค้านี้ — รีวิวได้หลังได้รับสินค้า</p>
      ) : (
        <div className="mt-6 grid gap-8 md:grid-cols-[280px_1fr] lg:gap-12">
          <div>
            <p className="text-[56px] font-semibold leading-none tracking-tight tabular-nums">{summary.rating_avg.toFixed(1)}</p>
            <Stars value={summary.rating_avg} size={18} className="mt-2" />
            <p className="mt-1 text-sm text-ink-2">จาก {thNumber(total)} รีวิว</p>
            <ul className="mt-5 space-y-1.5">
              {(["5", "4", "3", "2", "1"] as const).map((k) => {
                const n = summary.histogram[k] ?? 0;
                const pct = total ? Math.round((n * 100) / total) : 0;
                return (
                  <li key={k}>
                    <button type="button" onClick={() => pick({ rating: Number(k) })} className="flex w-full items-center gap-2 text-sm hover:opacity-80">
                      <span className="w-4 tabular-nums text-ink-2">{k}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-pill bg-canvas-alt">
                        <span className="block h-full rounded-pill bg-[#ff9f0a]" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-9 text-right tabular-nums text-ink-2">{pct}%</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="min-w-0">
            <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {chips.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => pick(c.f)}
                  aria-pressed={c.on}
                  className={clsx("shrink-0 rounded-pill px-3.5 py-1.5 text-sm font-medium transition active:scale-95", c.on ? "bg-ink text-white" : "bg-canvas-alt hover:bg-hairline-soft")}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <ul className={clsx("mt-4 divide-y divide-hairline-soft transition-opacity", loading && "opacity-50")} aria-busy={loading}>
              {list.map((r, i) => (
                <Reveal as="li" key={r.id} delay={Math.min(i, 4) * 0.05} className="py-5">
                  <div className="flex items-center gap-2">
                    <Stars value={r.rating} size={13} />
                    {r.title ? <span className="font-semibold">{r.title}</span> : null}
                  </div>
                  <p className="mt-1.5 leading-relaxed">{r.body}</p>
                  {r.images.length ? (
                    <ul className="mt-3 flex gap-2">
                      {r.images.map((im) => (
                        <li key={im.id} className="relative size-20 overflow-hidden rounded-[12px] bg-canvas-alt">
                          <Img src={im.url} alt={im.alt || "รูปจากผู้ซื้อ"} fill sizes="80px" className="object-cover" />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-2 text-xs text-ink-2">
                    {r.author_name}
                    {r.variant_name ? ` · ตัวเลือก ${r.variant_name}` : ""} ·{" "}
                    {thDate(r.created_at)}
                  </p>
                  {r.reply ? (
                    <div className="mt-3 flex gap-2 rounded-[14px] bg-canvas-alt p-3 text-sm">
                      <MessageSquareReply className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
                      <p>
                        <span className="font-semibold">ร้านตอบกลับ: </span>
                        {r.reply.body}
                      </p>
                    </div>
                  ) : null}
                </Reveal>
              ))}
              {!list.length && !loading ? <li className="py-8 text-center text-ink-2">ไม่มีรีวิวตามตัวกรองนี้</li> : null}
              {loading && !list.length ? (
                <li className="py-5">
                  <Skeleton className="h-16" />
                </li>
              ) : null}
            </ul>
            {meta.page < meta.total_pages ? (
              <button type="button" onClick={() => load(filter, meta.page + 1)} className="btn btn-secondary mt-2" disabled={loading}>
                ดูรีวิวเพิ่มเติม
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
