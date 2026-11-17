import { IntentLink as Link } from "@/components/ui/intent-link";
import type { Category } from "@/lib/api/types";
import { Icon } from "@/components/icon";
import { Reveal } from "@/components/ui/motion";

const TINTS = ["#eef4ff", "#fff3e8", "#eefaf1", "#f6efff", "#fff0f3", "#eef9fb"];

/** Category tiles (top level + sub-categories). Server component. */
export function CategoryTiles({ categories }: { categories: Category[] }) {
  const flat = categories.flatMap((c) => [c, ...c.children]);
  if (!flat.length) return null;
  return (
    <section aria-labelledby="cat-title" className="cv-section container-page py-12 md:py-16">
      <h2 id="cat-title" className="mb-6 text-[28px] font-semibold tracking-[-0.02em] md:mb-8 md:text-[40px]">
        ช้อปตามหมวดหมู่
      </h2>
      <ul className="no-scrollbar -mx-[var(--page-gutter)] flex gap-4 overflow-x-auto px-[var(--page-gutter)] pb-2 md:mx-0 md:grid md:grid-cols-5 md:px-0 lg:grid-cols-9">
        {flat.map((c, i) => (
          <Reveal as="li" key={c.id} delay={Math.min(i, 8) * 0.04} className="shrink-0">
            <Link href={`/c/${c.slug}`} className="group flex w-[84px] flex-col items-center gap-2 text-center md:w-auto">
              <span
                className="grid size-[76px] place-items-center rounded-[22px] transition-transform duration-500 ease-[cubic-bezier(.22,1,.36,1)] group-hover:-translate-y-1 group-hover:scale-105 group-active:scale-95 md:size-[88px]"
                style={{ background: TINTS[i % TINTS.length] }}
              >
                <Icon name={c.icon} className="size-8 text-ink" strokeWidth={1.5} />
              </span>
              <span className="text-[13px] font-medium leading-tight">{c.name}</span>
              {c.product_count ? <span className="-mt-1.5 text-[11px] text-ink-2">{c.product_count} สินค้า</span> : null}
            </Link>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}
