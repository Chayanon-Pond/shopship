import { Suspense } from "react";
import { preconnect } from "react-dom";
import { ChatWidget } from "@/components/assistant/chat-widget";
import { BottomNav } from "@/components/layout/bottom-nav";
import { CookieConsent } from "@/components/layout/cookie-consent";
import { Footer } from "@/components/layout/footer";
import { Header, type NavCategory } from "@/components/layout/header";
import { StoreProviders } from "@/components/store/providers";
import { categories } from "./_lib/data";

// Storefront chrome. Owner: Wave-1 "storefront" agent.
const MEDIA_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_MEDIA_ORIGIN ?? "").origin;
  } catch {
    return null;
  }
})();

export default async function SiteLayout({ children }: LayoutProps<"/">) {
  // product photos (LCP on product/category pages) come from the media origin: open the connection with the HTML
  if (MEDIA_ORIGIN) preconnect(MEDIA_ORIGIN);
  const cats = await categories();
  const nav: NavCategory[] = cats.map((c) => ({
    slug: c.slug,
    name: c.name,
    children: c.children.map((ch) => ({ slug: ch.slug, name: ch.name })),
  }));
  return (
    <StoreProviders>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:shadow-pop"
      >
        ข้ามไปเนื้อหาหลัก
      </a>
      <Header categories={nav} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer categories={nav} />
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
      <CookieConsent />
      <ChatWidget />
    </StoreProviders>
  );
}
