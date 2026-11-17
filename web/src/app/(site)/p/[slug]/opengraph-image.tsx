import { ogCard, ogSize } from "@/components/og";
import { formatBaht } from "@/lib/money";
import { popularSlugs, productOrNull } from "../../_lib/data";

export const alt = "สินค้า ShopShip";
export const size = ogSize;
export const contentType = "image/png";

export async function generateStaticParams() {
  const slugs = await popularSlugs();
  return (slugs.length ? slugs : ["__shell__"]).map((slug) => ({ slug }));
}

/** Product share card: name + PUBLIC price only. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await productOrNull(slug);
  if (!p) return ogCard({ eyebrow: "ShopShip", title: "ไม่พบสินค้า" });
  const price = p.flash ? `Flash Sale ${formatBaht(p.flash.sale_price_satang)}` : `${p.max_price_satang > p.min_price_satang ? "เริ่มต้น " : ""}${formatBaht(p.min_price_satang)}`;
  return ogCard({ eyebrow: p.brand || "ShopShip", title: p.name, line: price, accent: p.flash ? "#bf4800" : "#0071e3" });
}
