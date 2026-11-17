import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { pageMetadata } from "@/components/seo/meta";
import { Reveal } from "@/components/ui/motion";
import { categories } from "../_lib/data";

export const metadata: Metadata = pageMetadata({
  title: "หมวดหมู่สินค้าทั้งหมด",
  description: "เลือกช้อปตามหมวดหมู่ แฟชั่น อิเล็กทรอนิกส์ บ้านและครัว ที่ ShopShip",
  path: "/categories",
});

export default async function CategoriesPage() {
  const tree = await categories();
  return (
    <div className="container-page pb-16 pt-8 md:pt-12">
      <h1 className="text-[40px] font-semibold tracking-[-0.03em] md:text-[56px]">หมวดหมู่</h1>
      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {tree.map((c, i) => (
          <Reveal as="li" key={c.id} delay={i * 0.06} className="rounded-[24px] bg-canvas-alt p-6">
            <Link href={`/c/${c.slug}`} className="group flex items-center gap-4">
              <span className="grid size-14 place-items-center rounded-[18px] bg-white">
                <Icon name={c.icon} className="size-7" strokeWidth={1.5} />
              </span>
              <span className="flex-1">
                <span className="block text-xl font-semibold tracking-tight">{c.name}</span>
                <span className="text-sm text-ink-2">{c.product_count} สินค้า</span>
              </span>
              <ChevronRight className="size-5 text-ink-3 transition group-hover:translate-x-1" aria-hidden />
            </Link>
            {c.children.length ? (
              <ul className="mt-5 flex flex-wrap gap-2">
                {c.children.map((ch) => (
                  <li key={ch.id}>
                    <Link href={`/c/${ch.slug}`} className="inline-flex rounded-pill bg-white px-3.5 py-1.5 text-sm font-medium transition hover:bg-hairline-soft">
                      {ch.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Reveal>
        ))}
      </ul>
    </div>
  );
}
