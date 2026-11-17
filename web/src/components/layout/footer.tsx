import { IntentLink as Link } from "@/components/ui/intent-link";
import { CookieSettingsButton } from "@/components/store/consent";
import { site } from "@/lib/site";
import type { NavCategory } from "./header";
import { Logo } from "./logo";

export function Footer({ categories }: { categories: NavCategory[] }) {
  const cols: { title: string; links: [string, string][] }[] = [
    { title: "ช้อปตามหมวด", links: categories.map((c) => [c.name, `/c/${c.slug}`]) },
    {
      title: "โปรโมชัน",
      links: [
        ["Flash Sale", "/flash-sale"],
        ["โค้ดส่วนลดทั้งหมด", "/promotions"],
        ["ราคาส่ง / ลูกค้าขายส่ง", "/promotions#trade"],
        ["สิทธิ์สมาชิก", "/promotions#member"],
      ],
    },
    {
      title: "บัญชีของคุณ",
      links: [
        ["บัญชีของฉัน", "/account"],
        ["คำสั่งซื้อของฉัน", "/account/orders"],
        ["รายการโปรด", "/account/wishlist"],
        ["ตะกร้าสินค้า", "/cart"],
      ],
    },
    {
      title: "ช่วยเหลือ",
      links: [
        ["การชำระเงิน PromptPay / บัตร", "/promotions#payment"],
        ["การจัดส่ง Flash Express", "/promotions#shipping"],
        [`อีเมล ${site.email}`, `mailto:${site.email}`],
      ],
    },
  ];
  return (
    <footer className="cv-section mt-auto bg-canvas-alt text-[12px] leading-relaxed text-ink-2">
      <div className="container-page py-10">
        <p className="border-b border-hairline pb-4">
          ราคาที่ขีดฆ่าคือราคาต่ำสุดใน 30 วันก่อนเริ่มโปรโมชัน · ราคาสมาชิกและราคาส่งแสดงเมื่อเข้าสู่ระบบ · ราคารวมภาษีมูลค่าเพิ่มแล้ว
        </p>
        <div className="grid grid-cols-2 gap-8 py-8 md:grid-cols-4">
          {cols.map((c) => (
            <div key={c.title}>
              <h3 className="mb-2 font-semibold text-ink">{c.title}</h3>
              <ul className="space-y-1.5">
                {c.links.map(([label, href]) => (
                  <li key={href + label}>
                    <Link href={href} className="transition hover:text-ink hover:underline">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <nav aria-label="ข้อมูลทางกฎหมาย" className="border-t border-hairline py-4">
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
            {[
              ["นโยบายความเป็นส่วนตัว", "/legal/privacy"],
              ["นโยบายคุกกี้", "/legal/cookies"],
              ["ข้อกำหนดและเงื่อนไข", "/legal/terms"],
              ["การคืนสินค้าและคืนเงิน", "/legal/returns"],
              ["การจัดส่ง", "/legal/shipping"],
            ].map(([label, href]) => (
              <li key={href}>
                <Link href={href} className="transition hover:text-ink hover:underline">
                  {label}
                </Link>
              </li>
            ))}
            <li>
              <CookieSettingsButton className="cursor-pointer transition hover:text-ink hover:underline" />
            </li>
          </ul>
        </nav>
        <div className="flex flex-col gap-3 border-t border-hairline pt-5 md:flex-row md:items-center md:justify-between">
          <Logo className="text-ink" />
          <p>© {"2026"} {site.name}. สงวนลิขสิทธิ์ · ชำระเงินปลอดภัยด้วย PromptPay และบัตร · จัดส่งทั่วไทย</p>
        </div>
      </div>
    </footer>
  );
}
