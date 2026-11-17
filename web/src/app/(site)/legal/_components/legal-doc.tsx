import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { pageMetadata } from "@/components/seo/meta";

/*
 * Shared building blocks for /legal/* (owner: Praewa / legal).
 * Server components only, no client JS. Every value the shop owner must fill
 * is written as "[...]" and rendered with <Fill>, so it is easy to spot on the
 * page and with a search for "[" before launch. Lawyer checklist: docs/LEGAL-REVIEW.md.
 */

export const LEGAL_UPDATED = "2026-11-17";
export const LEGAL_UPDATED_TH = "17 พฤศจิกายน 2569";

/** Business identity placeholders, used by every legal page. Fill once here. */
export const entity = {
  company: "[ชื่อบริษัท / ชื่อผู้ประกอบการตามทะเบียน]",
  regNo: "[เลขทะเบียนนิติบุคคล / เลขประจำตัวผู้เสียภาษี 13 หลัก]",
  address: "[ที่อยู่สำนักงานตามทะเบียน]",
  returnAddress: "[ที่อยู่สำหรับส่งคืนสินค้า (ถ้าต่างจากที่อยู่สำนักงาน)]",
  email: "[อีเมลฝ่ายบริการลูกค้า]",
  privacyEmail: "[อีเมลติดต่อเรื่องข้อมูลส่วนบุคคล / DPO]",
  dpo: "[ชื่อหรือตำแหน่งเจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO) — ถ้ามีการแต่งตั้ง]",
  phone: "[เบอร์โทรศัพท์ฝ่ายบริการลูกค้า]",
  hours: "[วันและเวลาทำการ เช่น จันทร์–ศุกร์ 09:00–18:00 น.]",
  dbdNo: "[เลขทะเบียนพาณิชย์อิเล็กทรอนิกส์ / DBD Registered]",
  ocpbNo: "[เลขทะเบียนผู้ประกอบธุรกิจตลาดแบบตรง (สคบ.)]",
} as const;

export const LEGAL_PAGES = [
  { slug: "privacy", title: "นโยบายความเป็นส่วนตัว" },
  { slug: "cookies", title: "นโยบายคุกกี้" },
  { slug: "terms", title: "ข้อกำหนดและเงื่อนไขการใช้บริการ" },
  { slug: "returns", title: "นโยบายการคืนสินค้าและคืนเงิน" },
  { slug: "shipping", title: "การจัดส่ง" },
] as const;
export type LegalSlug = (typeof LEGAL_PAGES)[number]["slug"];

export function legalMetadata(slug: LegalSlug, title: string, description: string): Metadata {
  return pageMetadata({ title, description, path: `/legal/${slug}`, type: "article" });
}

export type LegalSection = { id: string; title: string; body: ReactNode };

/* ------------------------------------------------------------------ inline helpers */

/** A blank the shop owner must fill before launch. Renders the bracketed text, highlighted. */
export function Fill({ children }: { children: ReactNode }) {
  return <mark className="rounded-[4px] bg-sale-soft px-1 font-medium text-sale">{children}</mark>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 first:mt-0">{children}</p>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 text-[17px] font-semibold tracking-[-0.01em] text-ink">{children}</h3>;
}

export function UL({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-ink-3">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export function OL({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-3 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-ink-2">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = /^(https?:|mailto:|tel:)/.test(href);
  const cls = "text-link underline-offset-2 hover:underline";
  return external ? (
    <a href={href} className={cls} {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** Highlighted box for the one thing a reader must not miss. */
export function Callout({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-card bg-canvas-alt px-5 py-4">
      {title ? <p className="font-semibold text-ink">{title}</p> : null}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}

/** Simple table. Scrolls inside its own box on narrow screens (never the page). */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-card border border-hairline-soft">
      <table className="w-full min-w-[560px] border-collapse text-left text-[14px] leading-relaxed">
        <thead className="bg-canvas-alt text-ink">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-hairline-soft align-top">
              {r.map((c, j) => (
                <td key={j} className={j === 0 ? "px-4 py-3 font-medium text-ink" : "px-4 py-3"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Short at-a-glance cards shown before the full text. */
export function Highlights({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => (
        <div key={it.title} className="rounded-tile bg-canvas-alt p-5">
          <p className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{it.title}</p>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{it.body}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ page shell */

export function LegalDoc({
  slug,
  title,
  summaryEn,
  intro,
  highlights,
  sections,
}: {
  slug: LegalSlug;
  title: string;
  summaryEn: string;
  intro: ReactNode;
  highlights?: { title: string; body: ReactNode }[];
  sections: LegalSection[];
}) {
  return (
    <div className="container-page pb-16 pt-10 md:pt-16">
      <header className="mx-auto max-w-[720px] text-center">
        <p className="text-sm font-semibold text-ink-2">ข้อมูลทางกฎหมาย</p>
        <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-[-0.03em] md:text-[52px]">{title}</h1>
        <p lang="en" className="mx-auto mt-3 max-w-[600px] text-[14px] text-ink-2">
          {summaryEn}
        </p>
        <p className="mt-3 text-[13px] text-ink-2">
          ปรับปรุงล่าสุด <time dateTime={LEGAL_UPDATED}>{LEGAL_UPDATED_TH}</time>
        </p>
      </header>

      {highlights ? <div className="mx-auto mt-10 max-w-[960px]"><Highlights items={highlights} /></div> : null}

      <div className="mx-auto mt-10 grid max-w-[960px] gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="สารบัญ" className="hidden lg:block">
          <div className="sticky top-[calc(var(--header-h)+24px)]">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">สารบัญ</p>
            <ol className="mt-3 space-y-2 border-l border-hairline-soft text-[13px] leading-snug">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l border-transparent pl-3 text-ink-2 transition hover:border-ink hover:text-ink">
                    {i + 1}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <article className="min-w-0 max-w-[680px] text-[16px] leading-[1.75] text-ink-2">
          <details className="mb-8 rounded-card bg-canvas-alt px-5 py-3 lg:hidden">
            <summary className="cursor-pointer font-semibold text-ink">สารบัญ</summary>
            <ol className="mt-2 space-y-1.5 text-[14px]">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-link">
                    {i + 1}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </details>

          <div className="text-[17px] text-ink">{intro}</div>

          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-12 scroll-mt-[calc(var(--header-h)+24px)]">
              <h2 id={`${s.id}-h`} className="text-[24px] font-semibold leading-snug tracking-[-0.02em] text-ink md:text-[28px]">
                {i + 1}. {s.title}
              </h2>
              <div className="mt-3">{s.body}</div>
            </section>
          ))}

          <aside className="mt-16 border-t border-hairline pt-6 text-[14px]">
            <p className="font-semibold text-ink">เอกสารอื่นที่เกี่ยวข้อง</p>
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
              {LEGAL_PAGES.filter((p) => p.slug !== slug).map((p) => (
                <li key={p.slug}>
                  <Link href={`/legal/${p.slug}`} className="text-link hover:underline">
                    {p.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        </article>
      </div>
    </div>
  );
}

/** "Contact us" block reused at the end of several documents. */
export function ContactBlock() {
  return (
    <Callout>
      <p className="font-semibold text-ink">
        <Fill>{entity.company}</Fill>
      </p>
      <p>
        ที่อยู่: <Fill>{entity.address}</Fill>
      </p>
      <p>
        อีเมล: <Fill>{entity.email}</Fill> · โทร <Fill>{entity.phone}</Fill>
      </p>
      <p>
        เวลาทำการ: <Fill>{entity.hours}</Fill>
      </p>
    </Callout>
  );
}
